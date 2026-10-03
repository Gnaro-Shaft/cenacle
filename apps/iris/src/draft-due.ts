/**
 * Every due follow-up without a decision goes to the vote, once (phase 4, B3).
 * Used by the daemon after each collection, and by `npm run iris:draft`.
 */
import { followUpOf, type MailForModel } from "@cenacle/core";
import type { MailStore, ProposalStore } from "@cenacle/journal";
import { type DraftDeps, type DraftOutcome, draftFollowUp } from "./draft.ts";

export interface DraftDueDeps extends DraftDeps {
  readonly mails: MailStore;
  readonly store: ProposalStore;
  /** Reads the mails for the model; refuses a renumbered mailbox. */
  readonly read: (uids: readonly number[], uidValidity: string) => Promise<MailForModel[]>;
}

export interface DraftDueResult {
  /** Open proposals whose mail left the server (or the mailbox was renumbered): closed as lapsed. */
  readonly lapsed: number;
  readonly due: number;
  /** Due mails no longer on the server: said, never skipped silently. */
  readonly gone: number;
  readonly outcomes: readonly { readonly mail: MailForModel; readonly outcome: DraftOutcome }[];
}

/**
 * A proposal whose mail is gone can never be accepted (no recipient): it is
 * closed as lapsed instead of staying stuck on the page forever.
 */
export async function lapseOrphans(deps: DraftDueDeps): Promise<number> {
  const position = await deps.mails.position("inbox");
  const known = new Set((await deps.mails.inbox()).map((m) => m.uid));
  let lapsed = 0;
  for (const p of await deps.store.open()) {
    // Only what can still be decided: a mail being sent or a failed send is left alone.
    if (p.status !== "pending" && p.status !== "accepted") continue;
    const here =
      position !== null && p.mailUidValidity === position.uidValidity && known.has(p.mailUid);
    if (here) continue;
    await deps.proposals.lapse(p.id, deps.now());
    lapsed += 1;
  }
  return lapsed;
}

export async function draftDueFollowUps(deps: DraftDueDeps): Promise<DraftDueResult> {
  const lapsed = await lapseOrphans(deps);
  const position = await deps.mails.position("inbox");
  if (position === null) return { lapsed, due: 0, gone: 0, outcomes: [] };
  const now = deps.now();
  const sent = await deps.mails.sent();
  const inbox = await deps.mails.inbox();
  const todo: number[] = [];
  for (const m of inbox) {
    if (followUpOf(m, sent, now) !== "due") continue;
    if (!(await deps.store.existsFor(position.uidValidity, m.uid))) todo.push(m.uid);
  }
  if (todo.length === 0) return { lapsed, due: 0, gone: 0, outcomes: [] };
  const read = await deps.read(todo, position.uidValidity);
  const outcomes = [];
  for (const mail of read) {
    outcomes.push({ mail, outcome: await draftFollowUp(mail, position.uidValidity, deps) });
  }
  return { lapsed, due: todo.length, gone: todo.length - read.length, outcomes };
}
