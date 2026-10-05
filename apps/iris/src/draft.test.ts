// Iris drafts for one due follow-up: a proposal waiting for me, or nothing
// (split vote, no template) — decided once per mail, journaled without text.
import type { TrameVote } from "@cenacle/brain";
import type { MailForModel } from "@cenacle/core";
import { createProposals, EXAMPLE_TRAMES_PATH, loadTrames } from "@cenacle/mail";
import { memoryJournal, memoryProposalStore } from "@cenacle/mail/test-helpers";
import { describe, expect, it } from "vitest";
import { type DraftDeps, draftFollowUp } from "./draft.ts";

const TRAMES = loadTrames({ local: "/nonexistent/x.toml", example: EXAMPLE_TRAMES_PATH });
const mail: MailForModel = {
  uid: 42,
  fromName: "Claire Dubois",
  domain: "client.example",
  subject: "Re: Point d'avancement",
  text: "Bonjour, seriez-vous disponible jeudi à 14 h pour faire le point ? Claire",
};
const voted = (choice: string | null): TrameVote => ({ choice, votes: {}, rounds: 6, needed: 5 });

function setup(choice: string | null, copied: Record<string, string> = {}) {
  const journal = memoryJournal();
  const store = memoryProposalStore();
  let n = 0;
  const deps: DraftDeps = {
    authenticated: async () => true,
    trames: TRAMES,
    proposals: createProposals(store, journal),
    vote: async () => voted(choice),
    copySlots: async () => copied,
    newId: () => `p-${++n}`,
    now: () => new Date("2026-10-05T10:00:00Z"),
  };
  return { journal, store, deps };
}

describe("draftFollowUp", () => {
  it("fills the template: code slots, thread slot copied from the mail", async () => {
    const { store, deps } = setup("confirmer_creneau", { creneau: "jeudi à 14 h" });
    const r = await draftFollowUp(mail, "8", deps);
    expect(r).toMatchObject({ kind: "proposed", trame: "confirmer_creneau", toComplete: [] });
    const p = await store.get(r.proposalId);
    expect(p?.draft).toContain("Bonjour Claire,");
    expect(p?.draft).toContain("Jeudi à 14 h me convient");
    expect(p?.status).toBe("pending");
  });

  it("an invented slot value is left for me, visibly", async () => {
    const { store, deps } = setup("confirmer_creneau", { creneau: "vendredi à 9 h" });
    const r = await draftFollowUp(mail, "8", deps);
    expect(r).toMatchObject({ kind: "proposed", toComplete: ["creneau"] });
    expect((await store.get(r.proposalId))?.draft).toContain("{creneau ?}");
  });

  it("my slots ({delai}) are never filled by Iris", async () => {
    const { store, deps } = setup("accuse_reception");
    const r = await draftFollowUp(mail, "8", deps);
    expect(r).toMatchObject({ kind: "proposed", toComplete: ["delai"] });
    expect((await store.get(r.proposalId))?.draft).toContain("{delai ?}");
    expect((await store.get(r.proposalId))?.draft).toContain("« Point d'avancement »");
  });

  it.each([
    [null, "split"],
    ["aucune", "no_trame"],
    ["trame_inconnue", "no_trame"],
  ])("vote %j → nothing proposed (%s), recorded without text", async (choice, reason) => {
    const { store, journal, deps } = setup(choice);
    const r = await draftFollowUp(mail, "8", deps);
    expect(r).toMatchObject({ kind: "skipped", reason });
    const p = await store.get(r.proposalId);
    expect(p).toMatchObject({ status: "skipped", draft: null, trame: null });
    expect(await store.pending()).toHaveLength(0);
    expect(journal.events.map((e) => e.type)).toEqual(["proposal.skipped"]);
  });

  it("one decision per mail, ever: a skipped mail is not voted on again", async () => {
    const { deps } = setup(null);
    await draftFollowUp(mail, "8", deps);
    await expect(draftFollowUp(mail, "8", deps)).rejects.toThrow(/already exists/);
  });

  it("the journal never holds the draft nor the mail", async () => {
    const { journal, deps } = setup("confirmer_creneau", { creneau: "jeudi à 14 h" });
    await draftFollowUp(mail, "8", deps);
    const logged = JSON.stringify(journal.events.map((e) => [e.type, e.payload]));
    for (const secret of ["Claire", "jeudi", "Point d'avancement", "convient"]) {
      expect(logged).not.toContain(secret);
    }
  });
});
