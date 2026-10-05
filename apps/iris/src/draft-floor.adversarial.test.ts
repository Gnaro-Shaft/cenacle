// C2: a due follow-up whose mail the article 9 floor sets aside gets no draft.
// The model is never asked, and the journal says "set aside" — never why.
import type { MailForModel } from "@cenacle/core";
import { createProposals, EXAMPLE_TRAMES_PATH, keptFromModel, loadTrames } from "@cenacle/mail";
import { memoryJournal, memoryProposalStore } from "@cenacle/mail/test-helpers";
import { describe, expect, it } from "vitest";
import { draftFollowUp } from "./draft.ts";

const TRAMES = loadTrames({ local: "/nonexistent/x.toml", example: EXAMPLE_TRAMES_PATH });
const base: MailForModel = {
  uid: 9,
  fromName: "Claire Dubois",
  domain: "client.example",
  subject: "Point d'avancement",
  text: "Bonjour, seriez-vous disponible jeudi à 14 h ? Claire",
};

function setup() {
  const journal = memoryJournal();
  const store = memoryProposalStore();
  const asked: string[] = [];
  const deps = {
    authenticated: async () => true,
    trames: TRAMES,
    proposals: createProposals(store, journal),
    vote: async () => {
      asked.push("vote");
      return { choice: "confirmer_creneau", votes: {}, rounds: 6, needed: 5 };
    },
    copySlots: async () => {
      asked.push("copy");
      return {};
    },
    newId: () => "p-floor",
    now: () => new Date("2026-10-05T10:00:00Z"),
  };
  return { journal, store, asked, deps };
}

describe("drafting behind the article 9 floor", () => {
  it.each([
    ["a sensitive word in the text", { text: "Je serai en arrêt maladie jeudi. Claire" }],
    ["a sensitive word in the subject", { subject: "Mon état de santé" }],
    ["an empty or unreadable mail", { subject: "", text: "" }],
  ])("%s: skipped, the model never asked", async (_label, change) => {
    const w = setup();
    const outcome = await draftFollowUp({ ...base, ...change }, "1", w.deps);
    expect(outcome).toMatchObject({ kind: "skipped", reason: "set_aside" });
    expect(w.asked).toEqual([]);
    expect((await w.store.get("p-floor"))?.status).toBe("skipped");
    const payloads = JSON.stringify(w.journal.events.map((e) => e.payload));
    expect(payloads).toContain("set_aside");
    expect(payloads).not.toMatch(/sant|maladie|health/i);
  });

  it("an ordinary mail still goes to the vote", async () => {
    const w = setup();
    expect(keptFromModel(base)).toBe(false);
    await draftFollowUp(base, "1", w.deps);
    expect(w.asked[0]).toBe("vote");
  });
});

// M3 (ADR-0015): on a real box, a sender that is not authenticated never gets
// a draft — a forged From in a client's name must not get a reply built from its thread.
describe("drafting for an unauthenticated sender", () => {
  it("skipped before the model is asked, and the reason is journaled", async () => {
    const w = setup();
    const asked: { uid: number; validity: string }[] = [];
    const deps = {
      ...w.deps,
      authenticated: async (uid: number, validity: string) => {
        asked.push({ uid, validity });
        return false;
      },
    };
    const outcome = await draftFollowUp(base, "42", deps);
    expect(outcome).toMatchObject({ kind: "skipped", reason: "unauthenticated" });
    expect(asked).toEqual([{ uid: base.uid, validity: "42" }]);
    expect(w.asked).toEqual([]);
    expect((await w.store.get("p-floor"))?.status).toBe("skipped");
    expect(JSON.stringify(w.journal.events.map((e) => e.payload))).toContain("unauthenticated");
  });

  it("a check that throws drafts nothing either", async () => {
    const w = setup();
    const deps = {
      ...w.deps,
      authenticated: async () => {
        throw new Error("auth unreadable");
      },
    };
    await expect(draftFollowUp(base, "1", deps)).rejects.toThrow();
    expect(w.asked).toEqual([]);
    expect(await w.store.get("p-floor")).toBeNull();
  });
});
