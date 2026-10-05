/**
 * Is the sender of this mail authenticated, for drafting and sending? (phase
 * 5, M3 — ADR-0015)
 *
 * On a real box, Iris drafts only for an authenticated sender, and the
 * executor asks again before sending: a forged From in a client's name must
 * never get a reply built from its thread. The verdict itself is ADR-0014's
 * (sender-auth.ts, kept per mail as mail_items.sender_authenticated). Until
 * drafting is wired to that stored verdict, the answer is no — fail closed:
 * a real box opened for drafts gets none.
 * The fictional box and real test boxes do not ask (their mails are mine).
 */
import type { MailCadre } from "./cadre.ts";

export type SenderAuthCheck = (uid: number, uidValidity: string) => Promise<boolean>;

/** Not wired to the stored verdict yet: nobody is authenticated. */
export const noTrustRuleYet: SenderAuthCheck = async () => false;

export function senderAuthFor(
  mail: Pick<MailCadre, "authRequired">,
  check: SenderAuthCheck = noTrustRuleYet,
): SenderAuthCheck {
  return mail.authRequired === false ? async () => true : check;
}
