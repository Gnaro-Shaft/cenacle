// The bench is only worth something if it turns red when the guarantees
// break. Each mutant below removes one of them; the bench must catch it.
import { draftHash } from "@cenacle/core";
import { draftFollowUp } from "@cenacle/iris/draft";
import { ProposalError } from "@cenacle/journal";
import { describe, expect, it } from "vitest";
import { runDraftBench } from "./bench.ts";
import type { Mutations } from "./world.ts";

const failing = async (mutations: Mutations) =>
  (await runDraftBench(mutations)).checks.filter((c) => !c.ok);

/** Fills the slots with whatever the model says: no check at all. */
const naiveDrafter: typeof draftFollowUp = async (mail, uidValidity, deps) => {
  const vote = await deps.vote(mail, []);
  const trame = deps.trames.trames.get(vote.choice ?? "");
  if (trame === undefined) throw new Error("no template");
  const values: Record<string, string> = await deps.copySlots(mail, ["creneau", "sujet", "date"]);
  const text = trame.texte.replace(/\{([a-z_]+)\}/g, (_, s: string) => values[s] ?? `{${s} ?}`);
  const p = await deps.proposals.propose({
    id: deps.newId(),
    mailUidValidity: uidValidity,
    mailUid: mail.uid,
    trame: trame.id,
    draft: `${text.trim()}\n\n${deps.trames.signature}`,
  });
  return { kind: "proposed", proposalId: p.id, trame: trame.id, toComplete: [], vote };
};

/** Iris accepts her own proposal, with a signature she made up (she has no key). */
const selfAccepting: typeof draftFollowUp = async (mail, uidValidity, deps) => {
  const outcome = await draftFollowUp(mail, uidValidity, deps);
  if (outcome.kind === "proposed") {
    const signed = { signature: "A".repeat(86), draftHash: draftHash("") };
    await deps.proposals.accept(outcome.proposalId, deps.now(), signed).catch((error: unknown) => {
      if (!(error instanceof ProposalError)) throw error;
    });
  }
  return outcome;
};

describe("the draft bench", () => {
  it("is green on the real code", async () => {
    const report = await runDraftBench();
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(report.invention.drafts).toBeGreaterThan(400);
    expect(report.invention.legitKept).toBeGreaterThan(0);
  });

  it("catches an executor whose claim is not atomic (double send)", async () => {
    const red = await failing({
      tamper: (deps, sql) => ({
        ...deps,
        store: {
          ...deps.store,
          claim: async (id, now) => {
            await sql`
              update proposals set status = 'sending', send_after = null, sent_at = ${now}
              where id = ${id} and status in ('accepted', 'sending')`;
            const p = await deps.store.get(id);
            if (p === null) throw new ProposalError("gone");
            return p;
          },
        },
      }),
    });
    expect(red.map((c) => c.scenario)).toContain("double clic");
  });

  it("catches an executor that no longer checks whether I answered", async () => {
    const red = await failing({ tamper: (deps) => ({ ...deps, freshSent: async () => [] }) });
    expect(red.map((c) => c.scenario)).toContain("proposition caduque");
  });

  it("catches a reply diverted to the Reply-To", async () => {
    const red = await failing({
      tamper: (deps) => ({
        ...deps,
        context: async (p) => {
          const context = await deps.context(p);
          return context?.replyToElsewhere
            ? { ...context, to: "pirate@detournement.example" }
            : context;
        },
      }),
    });
    expect(red.map((c) => c.name)).toContain("mail 3 : à l'expéditeur, jamais ailleurs");
  });

  it("catches a page token that survives a restart (replay)", async () => {
    const red = await failing({ newToken: () => "the-same-token-at-every-start-xxxxxxxxxxx" });
    expect(red.map((c) => c.name)).toContain("accepter avec le jeton d'un démarrage précédent");
  });

  it("catches a drafter that does not check the slots (invention)", async () => {
    const red = await failing({ draft: naiveDrafter });
    expect(red.map((c) => c.name)).toContain("faits inventés arrivés dans une proposition");
  });

  it("Iris accepting by herself sends nothing: prevented, not only detected (ADR-0013)", async () => {
    const red = await failing({ draft: selfAccepting });
    const leaked = red.filter(
      (c) => c.name.endsWith("accepté sur la page") || c.name.includes("envoyé sans"),
    );
    expect(leaked).toEqual([]);
  });

  it("catches an executor that trusts any acceptance (no signature check)", async () => {
    const red = await failing({ tamper: (deps) => ({ ...deps, verify: () => true }) });
    expect(red.map((c) => c.name)).toContain("seule mon acceptation part");
  });
});
