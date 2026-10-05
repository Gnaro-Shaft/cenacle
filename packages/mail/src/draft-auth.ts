/**
 * Is the sender of this mail authenticated, for drafting and sending? (phase
 * 5, M3 — ADR-0015)
 *
 * On a real box, Iris drafts only for an authenticated sender, and the
 * executor asks again before sending: a forged From in a client's name must
 * never get a reply built from its thread. The verdict is ADR-0014's: our own
 * receiving server's header, read at collection time and kept with the mail
 * (mail_items.sender_authenticated). Here it is only looked up — yes only for
 * a mail Iris remembers, under the same UIDVALIDITY, marked authenticated.
 * Anything else (unknown mail, renumbered box, a mail remembered before the
 * verdict existed) is no.
 * The fictional box and real test boxes do not ask (their mails are mine).
 */
import type { MailCadre } from "./cadre.ts";

export type SenderAuthCheck = (uid: number, uidValidity: string) => Promise<boolean>;

/** What the check needs of Iris's memory (MailStore). */
export interface VerdictMemory {
  position(mailbox: "inbox"): Promise<{ readonly uidValidity: string } | null>;
  inbox(): Promise<readonly { readonly uid: number; readonly senderAuthenticated: boolean }[]>;
}

/** The verdict kept with the mail at collection time (ADR-0014). */
export function storedVerdict(memory: VerdictMemory): SenderAuthCheck {
  return async (uid, uidValidity) => {
    const position = await memory.position("inbox");
    if (position === null || position.uidValidity !== uidValidity) return false;
    const mail = (await memory.inbox()).find((m) => m.uid === uid);
    return mail?.senderAuthenticated === true;
  };
}

/** A test box does not ask; any other box asks `check`, which has no default. */
export function senderAuthFor(
  mail: Pick<MailCadre, "authRequired">,
  check: SenderAuthCheck,
): SenderAuthCheck {
  return mail.authRequired === false ? async () => true : check;
}
