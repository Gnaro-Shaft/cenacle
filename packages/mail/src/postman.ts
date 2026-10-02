/**
 * The postman: reads which mails are in a mailbox, and changes nothing.
 *
 * Read-only twice over: the mailbox is opened with EXAMINE (readOnly) and
 * only a few headers are fetched, with BODY.PEEK. This module must never call
 * an IMAP command that writes — an adversarial test scans it for them.
 *
 * Minimization (charter): for each mail it keeps the UID, the arrival date,
 * the sender's domain (inbox) and pseudonymous KEYS of the addresses and
 * thread identifiers (keys.ts). Raw headers are parsed and dropped at once.
 */
import { ImapFlow } from "imapflow";
import type { MailCadre } from "./cadre.ts";
import { type Keyer, messageIds } from "./keys.ts";
import { addressList, senderAddress, senderDomain } from "./sender-domain.ts";

/** An incoming mail, as remembered. */
export interface MailRef {
  readonly uid: number;
  /** Lowercased sender domain, or null when the From header is unreadable. */
  readonly domain: string | null;
  readonly senderKey: string | null;
  readonly messageKey: string | null;
  /** Keys of the mails it answers (In-Reply-To and References). */
  readonly threadKeys: readonly string[];
  readonly receivedAt: string;
}

/** One of my sent mails, as remembered. */
export interface SentRef {
  readonly uid: number;
  /** Keys of every To and Cc address. */
  readonly recipientKeys: readonly string[];
  readonly messageKey: string | null;
  readonly threadKeys: readonly string[];
  readonly sentAt: string;
}

export interface FetchResult<T> {
  /** Oldest first. At most `maxPerFetch`. */
  readonly refs: readonly T[];
  /** Changes when the server renumbers the mailbox: remembered UIDs are then void. */
  readonly uidValidity: string;
  /** Mails in the mailbox after `afterUid` (the ones this pass could see). */
  readonly available: number;
  /** True when the ceiling stopped this pass: run another from `lastUid`. */
  readonly truncated: boolean;
  /** UID of the last mail read, to start the next pass after it; null if none. */
  readonly lastUid: number | null;
  /** Unread mails after the pass — must equal the count before it. */
  readonly unseen: number;
}

export interface FetchOptions {
  /** Only read mails with a greater UID (new mails, or the next pass of a backlog). */
  readonly afterUid?: number;
}

export class PostmanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostmanError";
  }
}

const INBOX_HEADERS = ["from", "message-id", "in-reply-to", "references"];
const SENT_HEADERS = ["to", "cc", "message-id", "in-reply-to", "references"];

/** Header name → value; a header present twice is ambiguous and kept as null. */
export function splitHeaders(raw: string): Map<string, string | null> {
  const headers = new Map<string, string | null>();
  const unfolded = raw.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    headers.set(name, headers.has(name) ? null : value);
  }
  return headers;
}

interface RawEntry {
  readonly uid: number;
  readonly headers: Map<string, string | null>;
  readonly date: string;
}

async function unseenCount(client: ImapFlow, mailbox: string): Promise<number> {
  const status = await client.status(mailbox, { unseen: true });
  if (status === false || typeof status.unseen !== "number") {
    throw new PostmanError(`${mailbox}: unread count unavailable`);
  }
  return status.unseen;
}

async function readHeaders(
  cadre: MailCadre,
  password: string,
  mailbox: string,
  headerNames: string[],
  options: FetchOptions,
): Promise<FetchResult<RawEntry>> {
  const afterUid = options.afterUid ?? 0;
  if (!Number.isSafeInteger(afterUid) || afterUid < 0) {
    throw new PostmanError(`afterUid must be a non-negative integer, got ${afterUid}`);
  }
  if (password.length === 0) throw new PostmanError("empty mailbox password");

  const client = new ImapFlow({
    host: cadre.host,
    port: cadre.port,
    secure: false, // loopback test mailbox only (cadre refuses any other host); TLS in phase 5
    auth: { user: cadre.user, pass: password },
    logger: false,
  });
  await client.connect();
  try {
    const unseenBefore = await unseenCount(client, mailbox);
    const entries: RawEntry[] = [];
    let available = 0;
    let uidValidity = "";
    const lock = await client.getMailboxLock(mailbox, { readOnly: true });
    try {
      if (client.mailbox === false || !client.mailbox.readOnly) {
        throw new PostmanError(`${mailbox} was not opened read-only — refusing to read`);
      }
      uidValidity = String(client.mailbox.uidValidity);
      // "n:*" also returns the last mail when n is past it: filter on the UID.
      const found = await client.search({ uid: `${afterUid + 1}:*` }, { uid: true });
      const uids = (Array.isArray(found) ? found : [])
        .filter((uid) => uid > afterUid)
        .sort((a, b) => a - b);
      available = uids.length;
      const batch = uids.slice(0, cadre.maxPerFetch);
      if (batch.length > 0) {
        const query = { uid: true, internalDate: true, headers: headerNames };
        for await (const msg of client.fetch(batch.join(","), query, { uid: true })) {
          const date = msg.internalDate instanceof Date ? msg.internalDate : new Date(Number.NaN);
          if (Number.isNaN(date.getTime()))
            throw new PostmanError(`mail ${msg.uid}: no arrival date`);
          entries.push({
            uid: msg.uid,
            headers: splitHeaders(msg.headers?.toString("utf8") ?? ""),
            date: date.toISOString(),
          });
        }
      }
    } finally {
      lock.release();
    }
    entries.sort((a, b) => a.uid - b.uid);
    const unseen = await unseenCount(client, mailbox);
    if (unseen !== unseenBefore) {
      throw new PostmanError(
        `unread count changed during a read-only pass (${unseenBefore} → ${unseen})`,
      );
    }
    return {
      refs: entries,
      uidValidity,
      available,
      truncated: available > entries.length,
      lastUid: entries.at(-1)?.uid ?? null,
      unseen,
    };
  } finally {
    await client.logout().catch(() => client.close());
  }
}

function keysOf(keyer: Keyer, headers: Map<string, string | null>) {
  const own = messageIds(headers.get("message-id"))[0];
  const answered = [
    ...messageIds(headers.get("in-reply-to")),
    ...messageIds(headers.get("references")),
  ];
  return {
    messageKey: own === undefined ? null : keyer.messageId(own),
    threadKeys: [...new Set(answered.map((id) => keyer.messageId(id)))],
  };
}

/** Incoming mails of the cadre's mailbox. */
export async function fetchMailRefs(
  cadre: MailCadre,
  password: string,
  keyer: Keyer,
  options: FetchOptions = {},
): Promise<FetchResult<MailRef>> {
  const raw = await readHeaders(cadre, password, cadre.mailbox, INBOX_HEADERS, options);
  return {
    ...raw,
    refs: raw.refs.map(({ uid, headers, date }) => {
      const from = headers.get("from");
      const sender = senderAddress(from === undefined ? undefined : from);
      return {
        uid,
        domain: senderDomain(from === null ? null : from),
        senderKey: sender === null ? null : keyer.address(sender),
        ...keysOf(keyer, headers),
        receivedAt: date,
      };
    }),
  };
}

/** My sent mails, from the cadre's Sent folder. */
export async function fetchSentRefs(
  cadre: MailCadre,
  password: string,
  keyer: Keyer,
  options: FetchOptions = {},
): Promise<FetchResult<SentRef>> {
  const raw = await readHeaders(cadre, password, cadre.sentMailbox, SENT_HEADERS, options);
  return {
    ...raw,
    refs: raw.refs.map(({ uid, headers, date }) => {
      const recipients = [
        ...addressList(headers.get("to"), "to"),
        ...addressList(headers.get("cc"), "cc"),
      ];
      return {
        uid,
        recipientKeys: [...new Set(recipients.map((a) => keyer.address(a)))],
        ...keysOf(keyer, headers),
        sentAt: date,
      };
    }),
  };
}
