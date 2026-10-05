/**
 * Does a client or prospect still wait for my reply? (phase 3, S2)
 *
 * Pure code, no model, keys only. Rule validated on 2026-10-02:
 * - only "clients_prospects" mails are followed, unless their domain expects
 *   no reply by mail (platform notifications), and only when their sender is
 *   authenticated (ADR-0014): a forged From is never chased for a reply;
 * - a mail is "replied" if I sent, AFTER it, a mail in the same thread
 *   (its key among my mail's thread keys) or to the same address (its sender
 *   key among my mail's recipient keys) — a colleague's address does not count;
 * - otherwise it is "due" once 48 working hours have passed, else "waiting".
 */
import type { FollowUp } from "./fixtures.ts";
import { workingHoursBetween } from "./working-hours.ts";

export const FOLLOW_UP_HOURS = 48;
export const FOLLOW_UP_TIME_ZONE = "Europe/Paris";

export interface FollowedMail {
  readonly category: string | null;
  readonly noFollowUp: boolean;
  /** Our receiving server authenticated the From domain (ADR-0014). */
  readonly senderAuthenticated: boolean;
  readonly senderKey: string | null;
  readonly messageKey: string | null;
  readonly receivedAt: string;
}

export interface MyMail {
  readonly sentAt: string;
  readonly recipientKeys: readonly string[];
  readonly threadKeys: readonly string[];
}

export function followUpOf(mail: FollowedMail, sent: readonly MyMail[], now: Date): FollowUp {
  if (mail.category !== "clients_prospects" || mail.noFollowUp || !mail.senderAuthenticated) {
    return "not_tracked";
  }
  const received = Date.parse(mail.receivedAt);
  const answered = sent.some(
    (s) =>
      Date.parse(s.sentAt) > received &&
      ((mail.messageKey !== null && s.threadKeys.includes(mail.messageKey)) ||
        (mail.senderKey !== null && s.recipientKeys.includes(mail.senderKey))),
  );
  if (answered) return "replied";
  const elapsed = workingHoursBetween(new Date(received), now, FOLLOW_UP_TIME_ZONE);
  return elapsed >= FOLLOW_UP_HOURS ? "due" : "waiting";
}

export type FollowUpCounts = Readonly<Record<FollowUp, number>>;

export function countFollowUps(
  mails: readonly FollowedMail[],
  sent: readonly MyMail[],
  now: Date,
): FollowUpCounts {
  const counts = { not_tracked: 0, replied: 0, waiting: 0, due: 0 };
  for (const mail of mails) counts[followUpOf(mail, sent, now)]++;
  return counts;
}
