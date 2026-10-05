/**
 * Is the sender of this mail authenticated? (phase 5, M3 — ADR-0015)
 *
 * On a real box, Iris drafts only for an authenticated sender, and the
 * executor asks again before sending: a forged From in a client's name must
 * never get a reply built from its thread. Which evidence to trust (the
 * Authentication-Results of our own receiving server) is the trust rule of
 * the sender authentication work (ADR-0014). Until it exists, the answer is
 * no — fail closed: a real box opened for drafts gets none.
 * The fictional box and real test boxes do not ask (their mails are mine).
 */
import type { MailCadre } from "./cadre.ts";

export type SenderAuthCheck = (uid: number, uidValidity: string) => Promise<boolean>;

/** Until the trust rule exists: nobody is authenticated. */
export const noTrustRuleYet: SenderAuthCheck = async () => false;

export function senderAuthFor(
  mail: Pick<MailCadre, "authRequired">,
  check: SenderAuthCheck = noTrustRuleYet,
): SenderAuthCheck {
  return mail.authRequired === false ? async () => true : check;
}
