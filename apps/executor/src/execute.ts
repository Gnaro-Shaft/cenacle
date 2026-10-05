/**
 * The executor (phase 4, B4 — ADR-0004): no model, no judgement. It sends
 * only what I accepted, once the 2-minute undo delay is over, and checks
 * again at the last moment:
 * - the mail is still there and still waits for my answer (fresh read of my
 *   Sent folder: if I answered meanwhile, the proposal lapses);
 * - the recipient is read again from the server (the sender, never stored);
 * - at most 20 sending attempts a day;
 * - the page's signature of this very text (ADR-0013), checked BEFORE the
 *   claim — an unsigned acceptance is refused without a sending time, so
 *   forged acceptances cannot use up the daily ceiling — and again on the
 *   row claimed. Unsigned: never sent; failed, journaled and shown.
 * It claims a proposal before talking to the mail server, so a mail is sent
 * at most once: a failure is shown to me and never retried by itself.
 */
import { dayStart, type FollowedMail, followUpOf, type MyMail } from "@cenacle/core";
import { type Journal, type Proposal, ProposalError, type ProposalStore } from "@cenacle/journal";
import type { BuiltReply, Proposals, ReplyContext } from "@cenacle/mail";

const AGENT = "iris";

export interface ExecutorDeps {
  readonly store: ProposalStore;
  /** For lapsing, with its journal. */
  readonly proposals: Proposals;
  readonly journal: Journal;
  readonly now: () => Date;
  /** What Iris remembers of the mail; null when it is gone or the mailbox was renumbered. */
  readonly mailOf: (p: Proposal) => Promise<FollowedMail | null>;
  /** My sent mails, read again from the server just now. */
  readonly freshSent: () => Promise<readonly MyMail[]>;
  /** Read from the server at sending time; undefined when the mail is gone. */
  readonly context: (p: Proposal) => Promise<ReplyContext | undefined>;
  readonly build: (context: ReplyContext, text: string, date: Date) => Promise<BuiltReply>;
  readonly send: (reply: BuiltReply) => Promise<void>;
  readonly copy: (reply: BuiltReply) => Promise<void>;
  /** Whether this exact row was accepted on the page (its signature, the public key). */
  readonly verify: (p: Proposal) => boolean;
  /** Sends a day at most (the box's: 20 for a test box, 5 by default for a real one). */
  readonly maxPerDay: number;
  /** The box's undo delay, checked again here (the page sets it): 10 min on a real box. */
  readonly undoMs: number;
  /** M3: the sender is authenticated, asked again before sending (ADR-0015). */
  readonly authenticated: (p: Proposal) => Promise<boolean>;
}

export type LapseReason = "gone" | "answered" | "no_recipient" | "unauthenticated";

export interface RoundResult {
  readonly sent: readonly string[];
  readonly failed: readonly string[];
  /** Accepted without a valid signature of the page: never sent. */
  readonly unsigned: readonly string[];
  readonly lapsed: readonly { readonly id: string; readonly reason: LapseReason }[];
  /** The daily limit stopped this round. */
  readonly limited: boolean;
}

const errorName = (error: unknown) => (error instanceof Error ? error.name : "unknown");

export async function executeDue(deps: ExecutorDeps): Promise<RoundResult> {
  const sent: string[] = [];
  const failed: string[] = [];
  const unsigned: string[] = [];
  const lapsed: { id: string; reason: LapseReason }[] = [];
  const due = await deps.store.dueForSending(deps.now());
  if (due.length === 0) return { sent, failed, unsigned, lapsed, limited: false };
  const mine = await deps.freshSent();

  for (const p of due) {
    const now = deps.now();
    if ((await deps.store.sendsSince(dayStart(now))) >= deps.maxPerDay) {
      return { sent, failed, unsigned, lapsed, limited: true };
    }
    const journalUnsigned = async () => {
      await deps.journal.append({
        agent: AGENT,
        type: "send.unsigned",
        payload: { proposalId: p.id },
      });
      unsigned.push(p.id);
    };
    // The undo delay of the box, again: a page set to a shorter one does not shorten it.
    if (p.decidedAt === null || now.getTime() - p.decidedAt.getTime() < deps.undoMs) continue;
    if (!deps.verify(p)) {
      await deps.store.refuseUnsigned(p.id, now);
      await journalUnsigned();
      continue;
    }
    const lapse = async (reason: LapseReason) => {
      await deps.proposals.lapse(p.id, now);
      lapsed.push({ id: p.id, reason });
    };
    const mail = await deps.mailOf(p);
    if (mail === null) {
      await lapse("gone");
      continue;
    }
    if (followUpOf(mail, mine, now) !== "due") {
      await lapse("answered");
      continue;
    }
    const context = await deps.context(p);
    if (context === undefined) {
      await lapse("gone");
      continue;
    }
    if (context.to === null) {
      await lapse("no_recipient");
      continue;
    }
    if (!(await deps.authenticated(p))) {
      await lapse("unauthenticated");
      continue;
    }

    let claimed: Proposal;
    try {
      claimed = await deps.store.claim(p.id, now);
    } catch (error) {
      if (error instanceof ProposalError) continue; // another executor took it, or I cancelled just now
      throw error;
    }
    // Checked on the row just claimed, whose text the database now keeps frozen.
    if (!deps.verify(claimed)) {
      await deps.store.markFailed(p.id, deps.now());
      await journalUnsigned();
      continue;
    }
    let reply: BuiltReply;
    try {
      reply = await deps.build(context, claimed.draft ?? "", now);
      await deps.send(reply);
    } catch (error) {
      await deps.store.markFailed(p.id, deps.now());
      await deps.journal.append({
        agent: AGENT,
        type: "send.failed",
        payload: { proposalId: p.id, reason: errorName(error) },
      });
      failed.push(p.id);
      continue;
    }
    await deps.store.markSent(p.id, deps.now());
    await deps.journal.append({ agent: AGENT, type: "send.sent", payload: { proposalId: p.id } });
    sent.push(p.id);
    try {
      await deps.copy(reply);
    } catch (error) {
      // Sent, but Iris will not see it in Sent: said, never hidden.
      await deps.journal.append({
        agent: AGENT,
        type: "send.copy_failed",
        payload: { proposalId: p.id, reason: errorName(error) },
      });
    }
  }
  return { sent, failed, unsigned, lapsed, limited: false };
}
