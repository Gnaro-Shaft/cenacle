/**
 * Iris drafts a reply for one due follow-up (phase 4, B2).
 *
 * 1. Vote on the template (5 votes out of 6 must agree). Split vote, or "no
 *    template fits": Iris proposes nothing and the follow-up stays mine.
 * 2. The code fills {prenom} and {objet}; Iris copies the thread slots from
 *    the mail; my slots ({delai}…) stay visible for me to complete.
 * 3. The fact checker reads the final draft: one fact absent from the thread
 *    and the draft is dropped (never shown, never proposed).
 * Only this mail is in the model's context; nothing is sent here, ever.
 * Whatever the outcome, it is recorded once: the mail is never voted on again.
 */
import {
  isThreadSlot,
  NO_TRAME,
  type ThreadSlot,
  type TrameOption,
  type TrameVote,
} from "@cenacle/brain";
import { checkDraft, type MailForModel } from "@cenacle/core";
import {
  firstName,
  type Proposals,
  renderTrame,
  type SkipReason,
  type Slot,
  type SlotValues,
  type Trames,
} from "@cenacle/mail";

export interface DraftDeps {
  readonly trames: Trames;
  readonly proposals: Proposals;
  readonly vote: (mail: MailForModel, options: readonly TrameOption[]) => Promise<TrameVote>;
  readonly copySlots: (
    mail: MailForModel,
    slots: readonly ThreadSlot[],
  ) => Promise<Partial<Record<ThreadSlot, string>>>;
  readonly newId: () => string;
  readonly now: () => Date;
}

export type DraftOutcome =
  | {
      readonly kind: "proposed";
      readonly proposalId: string;
      readonly trame: string;
      readonly toComplete: readonly Slot[];
      readonly vote: TrameVote;
    }
  | {
      readonly kind: "skipped";
      readonly proposalId: string;
      readonly reason: SkipReason;
      readonly vote: TrameVote;
    };

export async function draftFollowUp(
  mail: MailForModel,
  mailUidValidity: string,
  deps: DraftDeps,
): Promise<DraftOutcome> {
  const { trames, signature } = deps.trames;
  const where = { id: deps.newId(), mailUidValidity, mailUid: mail.uid };
  const skip = async (reason: SkipReason, vote: TrameVote): Promise<DraftOutcome> => {
    const p = await deps.proposals.skip(where, reason, deps.now());
    return { kind: "skipped", proposalId: p.id, reason, vote };
  };

  const options = [...trames.values()].map((t) => ({ id: t.id, quand: t.quand }));
  const vote = await deps.vote(mail, options);
  if (vote.choice === null) return skip("split", vote);
  const trame = trames.get(vote.choice);
  if (vote.choice === NO_TRAME || trame === undefined) return skip("no_trame", vote);

  const wanted = trame.slots.filter(isThreadSlot);
  const copied = wanted.length === 0 ? {} : await deps.copySlots(mail, wanted);
  const prenom = firstName(mail.fromName);
  const values: SlotValues = {
    ...copied,
    ...(prenom === null ? {} : { prenom }),
    objet: mail.subject.replace(/^(re|tr|fwd?)\s*:\s*/i, ""),
  };
  const conversation = [mail.subject, mail.text];
  const rendered = renderTrame(trame, values, conversation, signature);
  // Last line of defence: every fact of the draft is in the thread or in my own words.
  if (!checkDraft(rendered.text, [...conversation, trame.texte, signature]).ok) {
    return skip("unsupported_fact", vote);
  }
  const p = await deps.proposals.propose({ ...where, trame: trame.id, draft: rendered.text });
  return {
    kind: "proposed",
    proposalId: p.id,
    trame: trame.id,
    toComplete: rendered.toComplete,
    vote,
  };
}
