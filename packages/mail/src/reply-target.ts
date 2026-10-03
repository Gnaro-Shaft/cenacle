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
import { PostmanError } from "./postman.ts";

export interface ReplyTarget {
  readonly uid: number;
  /** The only address a reply may go to; null when the sender cannot be read safely. */
  readonly to: string | null;
  /** The mail asks to be answered at another address (ignored, shown in red). */
  readonly replyToElsewhere: boolean;
}

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
  const targets = new Map<number, ReplyTarget>();
  if (uids.length === 0) return targets;
  if (!uids.every((uid) => Number.isSafeInteger(uid) && uid > 0)) {
    throw new PostmanError("UIDs must be positive integers");
  }
  const client = new ImapFlow({
    host: cadre.host,
    port: cadre.port,
    secure: false, // loopback test mailbox only (cadre refuses any other host); TLS in phase 5
    auth: { user: cadre.user, pass: password },
    logger: false,
  });
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
      for await (const msg of client.fetch(
        uids.join(","),
        { uid: true, envelope: true },
        { uid: true },
      )) {
        targets.set(msg.uid, replyTargetOf(msg.uid, msg.envelope?.from, msg.envelope?.replyTo));
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
