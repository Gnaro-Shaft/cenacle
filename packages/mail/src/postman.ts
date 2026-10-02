/**
 * The postman: reads which mails are in the mailbox, and changes nothing.
 *
 * Read-only twice over: the mailbox is opened with EXAMINE (readOnly) and only
 * the From header is fetched, with BODY.PEEK. This module must never call an
 * IMAP command that writes — an adversarial test scans it for them.
 *
 * Minimization (charter): for each mail it keeps the UID and the sender's
 * domain. The From header is parsed and dropped at once.
 */
import { ImapFlow } from "imapflow";
import type { MailCadre } from "./cadre.ts";
import { senderDomain } from "./sender-domain.ts";

export interface MailRef {
  readonly uid: number;
  /** Lowercased sender domain, or null when the From header is unreadable. */
  readonly domain: string | null;
}

export interface FetchResult {
  /** Oldest first. At most `maxPerFetch`. */
  readonly refs: readonly MailRef[];
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
  /** Only read mails with a greater UID (next pass of a large backlog). */
  readonly afterUid?: number;
}

export class PostmanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostmanError";
  }
}

function connect(cadre: MailCadre, password: string): ImapFlow {
  return new ImapFlow({
    host: cadre.host,
    port: cadre.port,
    secure: false, // loopback test mailbox only (cadre refuses any other host); TLS in phase 5
    auth: { user: cadre.user, pass: password },
    logger: false,
  });
}

async function unseenCount(client: ImapFlow, mailbox: string): Promise<number> {
  const status = await client.status(mailbox, { unseen: true });
  if (status === false || typeof status.unseen !== "number") {
    throw new PostmanError(`${mailbox}: unread count unavailable`);
  }
  return status.unseen;
}

export async function fetchMailRefs(
  cadre: MailCadre,
  password: string,
  options: FetchOptions = {},
): Promise<FetchResult> {
  const afterUid = options.afterUid ?? 0;
  if (!Number.isSafeInteger(afterUid) || afterUid < 0) {
    throw new PostmanError(`afterUid must be a non-negative integer, got ${afterUid}`);
  }
  if (password.length === 0) throw new PostmanError("empty mailbox password");

  const client = connect(cadre, password);
  await client.connect();
  try {
    const unseenBefore = await unseenCount(client, cadre.mailbox);
    const refs: MailRef[] = [];
    let available = 0;
    const lock = await client.getMailboxLock(cadre.mailbox, { readOnly: true });
    try {
      if (client.mailbox === false || !client.mailbox.readOnly) {
        throw new PostmanError(`${cadre.mailbox} was not opened read-only — refusing to read`);
      }
      // "n:*" also returns the last mail when n is past it: filter on the UID.
      const found = await client.search({ uid: `${afterUid + 1}:*` }, { uid: true });
      const uids = (Array.isArray(found) ? found : [])
        .filter((uid) => uid > afterUid)
        .sort((a, b) => a - b);
      available = uids.length;
      const batch = uids.slice(0, cadre.maxPerFetch);
      if (batch.length > 0) {
        const query = { uid: true, headers: ["from"] };
        for await (const msg of client.fetch(batch.join(","), query, { uid: true })) {
          refs.push({ uid: msg.uid, domain: senderDomain(msg.headers?.toString("utf8")) });
        }
      }
    } finally {
      lock.release();
    }
    refs.sort((a, b) => a.uid - b.uid);
    const unseen = await unseenCount(client, cadre.mailbox);
    if (unseen !== unseenBefore) {
      throw new PostmanError(
        `unread count changed during a read-only pass (${unseenBefore} → ${unseen})`,
      );
    }
    return {
      refs,
      available,
      truncated: available > refs.length,
      lastUid: refs.at(-1)?.uid ?? null,
      unseen,
    };
  } finally {
    await client.logout().catch(() => client.close());
  }
}
