/**
 * Proposals with their journal (phase 4, B1). The store enforces the life
 * cycle; this module journals each step — ids and outcomes, never the draft.
 * The bubble on Iris's box counts the proposals waiting for me.
 */
import type { Journal, Proposal, ProposalStore } from "@cenacle/journal";

const AGENT = "iris";

export interface Proposals {
  propose(input: {
    readonly id: string;
    readonly mailUidValidity: string;
    readonly mailUid: number;
    readonly trame: string | null;
    readonly draft: string;
  }): Promise<Proposal>;
  accept(id: string, now: Date): Promise<Proposal>;
  refuse(id: string, now: Date): Promise<Proposal>;
  /** The situation no longer holds (I already answered). */
  lapse(id: string, now: Date): Promise<Proposal>;
  /** I undo an accepted proposal within the delay. */
  cancel(id: string, now: Date): Promise<Proposal>;
}

export function createProposals(store: ProposalStore, journal: Journal): Proposals {
  const closed = (id: string, outcome: string) =>
    journal.append({ agent: AGENT, type: "proposal.closed", payload: { proposalId: id, outcome } });
  return {
    async propose(input) {
      const p = await store.create(input);
      await journal.append({
        agent: AGENT,
        type: "proposal.created",
        payload: { proposalId: p.id },
      });
      return p;
    },
    async accept(id, now) {
      const p = await store.accept(id, now);
      await closed(id, "accepted");
      return p;
    },
    async refuse(id, now) {
      const p = await store.refuse(id, now);
      await closed(id, "refused");
      return p;
    },
    async lapse(id, now) {
      const before = await store.get(id);
      const p = await store.lapse(id, now);
      // Still waiting for me: it leaves the bubble. Already accepted: the sending is called off.
      if (before?.status === "pending") await closed(id, "lapsed");
      else await journal.append({ agent: AGENT, type: "send.lapsed", payload: { proposalId: id } });
      return p;
    },
    async cancel(id, now) {
      const p = await store.cancel(id, now);
      await journal.append({ agent: AGENT, type: "send.cancelled", payload: { proposalId: id } });
      return p;
    },
  };
}
