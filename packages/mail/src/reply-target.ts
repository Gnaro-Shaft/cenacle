/**
 * Who a reply goes to (phase 4, B3 — decided 03/10): always the sender of the
 * mail, read again from the server at the moment it is needed, never stored.
 * A Reply-To pointing elsewhere is a classic diversion: it is reported, never
 * used. A sender with no address, several addresses or an odd address has no
 * reply target at all — the proposal cannot be accepted.
 * Same read-only guarantees as the postman (EXAMINE, unread count checked).
 */
import { ImapFlow } from "imapflow";
import type { MailCadre } from "./cadre.ts";
import { imapOptions } from "./connection.ts";
import { decodeSubject, PostmanError, splitHeaders } from "./postman.ts";

export interface ReplyTarget {
  readonly uid: number;
  /** The only address a reply may go to; null when the sender cannot be read safely. */
  readonly to: string | null;
  /** The mail asks to be answered at another address (ignored, shown in red). */
  readonly replyToElsewhere: boolean;
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * The subject of the mail answered. A raw 8-bit UTF-8 subject (no RFC 2047
 * encoding, common in practice) is read by the IMAP envelope as Latin-1
 * ("Point d'Ã©tape"): it is decoded again here from the raw header bytes
 * (given as a latin1 string, one char per byte). When those bytes are not
 * valid UTF-8 (a real Latin-1 subject), or the header is missing or doubled,
 * the envelope is kept: it is right then.
 */
export function subjectOf(rawLatin1: string | null | undefined, envelope: string | undefined) {
  const fallback = envelope ?? "";
  if (typeof rawLatin1 !== "string" || !/[\x80-\xff]/.test(rawLatin1)) return fallback;
  try {
    return decodeSubject(strictUtf8.decode(Buffer.from(rawLatin1, "latin1")));
  } catch {
    return fallback;
  }
}

/** What the executor needs to answer in the same thread (B4), read at sending time. */
export interface ReplyContext extends ReplyTarget {
  readonly subject: string;
  /** Message-ID of the mail answered, when valid. */
  readonly messageId: string | null;
  /** Its References, valid ids only. */
  readonly references: readonly string[];
}

const MESSAGE_ID = /^<[^<>\s]{1,250}>$/;
export const validMessageId = (raw: string | undefined | null): string | null => {
  const id = raw?.trim() ?? "";
  return MESSAGE_ID.test(id) ? id : null;
};

/** Each domain label starts and ends with a letter or digit. */
const ADDRESS_RULE =
  /^[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

/** A single, plain address, lower-cased domain; anything else is refused. */
export function safeAddress(raw: string | undefined): string | null {
  if (raw === undefined || /[\r\n]/.test(raw)) return null;
  const address = raw.trim();
  if (address.length > 254 || !ADDRESS_RULE.test(address)) return null;
  const at = address.lastIndexOf("@");
  return `${address.slice(0, at)}@${address.slice(at + 1).toLowerCase()}`;
}

interface AddressLike {
  readonly address?: string | undefined;
}

export function replyTargetOf(
  uid: number,
  from: readonly AddressLike[] | undefined,
  replyTo: readonly AddressLike[] | undefined,
): ReplyTarget {
  const senders = from ?? [];
  const to = senders.length === 1 ? safeAddress(senders[0]?.address) : null;
  const replyToElsewhere = (replyTo ?? []).some(
    (r) => (safeAddress(r.address) ?? r.address ?? "").toLowerCase() !== (to ?? "").toLowerCase(),
  );
  return { uid, to, replyToElsewhere };
}

async function unseenCount(client: ImapFlow, mailbox: string): Promise<number> {
  const status = await client.status(mailbox, { unseen: true });
  if (status === false || typeof status.unseen !== "number") {
    throw new PostmanError(`${mailbox}: unread count unavailable`);
  }
  return status.unseen;
}

/** Reply targets of the given mails; a mail gone from the server is simply absent. */
export async function readReplyTargets(
  cadre: MailCadre,
  password: string,
  uids: readonly number[],
  expectedUidValidity: string,
): Promise<Map<number, ReplyTarget>> {
  const contexts = await readReplyContexts(cadre, password, uids, expectedUidValidity);
  return new Map(
    [...contexts].map(([uid, c]) => [uid, { uid, to: c.to, replyToElsewhere: c.replyToElsewhere }]),
  );
}

/** Same read, with what a reply in the same thread needs. */
export async function readReplyContexts(
  cadre: MailCadre,
  password: string,
  uids: readonly number[],
  expectedUidValidity: string,
): Promise<Map<number, ReplyContext>> {
  const targets = new Map<number, ReplyContext>();
  if (uids.length === 0) return targets;
  if (!uids.every((uid) => Number.isSafeInteger(uid) && uid > 0)) {
    throw new PostmanError("UIDs must be positive integers");
  }
  const client = new ImapFlow(imapOptions(cadre, password));
  await client.connect();
  try {
    const unseenBefore = await unseenCount(client, cadre.mailbox);
    const lock = await client.getMailboxLock(cadre.mailbox, { readOnly: true });
    try {
      if (client.mailbox === false || !client.mailbox.readOnly) {
        throw new PostmanError(`${cadre.mailbox} was not opened read-only — refusing to read`);
      }
      const current = String(client.mailbox.uidValidity);
      if (current !== expectedUidValidity) {
        throw new PostmanError(
          `${cadre.mailbox} was renumbered (UIDVALIDITY ${expectedUidValidity} → ${current}) — run mail:sort again first`,
        );
      }
      const query = { uid: true, envelope: true, headers: ["references", "subject"] };
      for await (const msg of client.fetch(uids.join(","), query, { uid: true })) {
        const target = replyTargetOf(msg.uid, msg.envelope?.from, msg.envelope?.replyTo);
        // Bytes kept as they are (latin1 is one char per byte); the subject decides its charset.
        const headers = splitHeaders(msg.headers?.toString("latin1") ?? "");
        const rawRefs = headers.get("references") ?? "";
        targets.set(msg.uid, {
          ...target,
          subject: subjectOf(headers.get("subject"), msg.envelope?.subject),
          messageId: validMessageId(msg.envelope?.messageId),
          references: (rawRefs.match(/<[^<>\s]{1,250}>/g) ?? []).slice(-20),
        });
      }
    } finally {
      lock.release();
    }
    const unseen = await unseenCount(client, cadre.mailbox);
    if (unseen !== unseenBefore) {
      throw new PostmanError(
        `unread count changed during a read-only pass (${unseenBefore} → ${unseen})`,
      );
    }
    return targets;
  } finally {
    await client.logout().catch(() => client.close());
  }
}
