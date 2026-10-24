// ADR-0034: a confirmation of my application is told by its exact, declared,
// authenticated address — never by its words — and becomes one card in
// « applied », or none; the journal still gets numbers only.
import { describe, expect, it } from "vitest";
import { type Outcome, runProspection } from "./run.ts";
import { ModelDown, source, world } from "./run-test-world.ts";

const CONFIRMATION = source(
  "candidatures@plateforme.example",
  '<p>Votre candidature à Ingénieur IA chez Banque Fictive (Lyon) a bien été envoyée. <a href="https://plateforme.example/m/1">voir</a></p>',
);
const ONE = JSON.stringify([
  { intitule: "Ingénieur IA", entreprise: "Banque Fictive", lieu: "Lyon", lien: 1 },
]);

describe("a pass — confirmations of my applications", () => {
  it("a confirmation from a declared address becomes one card, by its own prompt", async () => {
    const w = world([{ id: 1, source: CONFIRMATION }], { ask: async () => ONE });
    const { counts } = await runProspection(w.deps);
    expect(w.recorded).toEqual([]);
    expect(w.applications).toHaveLength(1);
    expect(w.applications[0]?.card).toMatchObject({
      platform: "Plateforme fictive",
      title: "Ingénieur IA",
      company: "Banque Fictive",
      link: "https://plateforme.example/m/1",
      intermediary: "inconnu",
      stack: [],
      rate: null,
      keys: {
        own: "applied|plateforme fictive|ingenieur ia|banque fictive|lyon",
        alert: "plateforme fictive|ingenieur ia|banque fictive|lyon",
      },
    });
    expect(counts).toMatchObject({ application: 1, applications_added: 1, read: 0, alert: 0 });
  });

  it("the prompt asked is the confirmation's, never the alerts'", async () => {
    const w = world([{ id: 1, source: CONFIRMATION }], {
      ask: async (_q, system) => {
        w.systems.push(system);
        return ONE;
      },
    });
    await runProspection(w.deps);
    expect(w.systems).toHaveLength(1);
    expect(w.systems[0]).toMatch(/confirmation, envoyée par une plateforme/);
  });

  it("an alert that calls itself a confirmation stays an alert: only the address counts", async () => {
    const w = world([
      {
        id: 1,
        source: source(
          "alertes@plateforme.example",
          "<p>Confirmation de candidature : votre candidature a bien été envoyée.</p>",
        ),
      },
    ]);
    await runProspection(w.deps);
    expect(w.applications).toEqual([]);
    expect(w.systems[0]).not.toMatch(/confirmation, envoyée/);
    expect(w.recorded[0]?.outcome).toBe("read");
  });

  it("an undeclared address of the same platform is read as an alert", async () => {
    const w = world([
      { id: 1, source: source("autre@plateforme.example", "<p>Votre candidature</p>") },
    ]);
    await runProspection(w.deps);
    expect(w.applications).toEqual([]);
    expect(w.recorded[0]?.outcome).toBe("read");
  });

  it("the same address in another case is the same address", async () => {
    const w = world(
      [{ id: 1, source: source("Candidatures@Plateforme.example", "<p>Votre candidature</p>") }],
      { ask: async () => ONE },
    );
    await runProspection(w.deps);
    expect(w.applications).toHaveLength(1);
  });

  it.each<[string, { auth?: boolean; source: Buffer }, Outcome]>([
    ["unauthenticated", { auth: false, source: CONFIRMATION }, "unauthenticated"],
    [
      "from a look-alike domain",
      { source: source("candidatures@plateforme.example.net", "<p>Votre candidature</p>") },
      "not_platform",
    ],
    [
      "holding a word of the article 9 floor",
      {
        source: source("candidatures@plateforme.example", "<p>Votre candidature, handicap</p>"),
      },
      "floor",
    ],
  ])("a confirmation %s never reaches the model", async (_, mail, outcome) => {
    const w = world([{ id: 1, ...mail }]);
    await runProspection(w.deps);
    expect(w.asked).toEqual([]);
    expect(w.applications).toEqual([]);
    expect(w.recorded[0]?.outcome).toBe(outcome);
  });

  it.each([
    ["two missions", JSON.stringify([JSON.parse(ONE)[0], JSON.parse(ONE)[0]])],
    ["none", "[]"],
    ["no JSON", "Je ne peux pas."],
    ["a mission without a title", JSON.stringify([{ intitule: "", entreprise: "X" }])],
  ])("a confirmation read as %s keeps no card, and says so", async (_, answer) => {
    const w = world([{ id: 1, source: CONFIRMATION }], { ask: async () => answer });
    const { counts } = await runProspection(w.deps);
    expect(w.applications).toEqual([]);
    expect(w.recorded[0]?.outcome).toBe("application_unreadable");
    expect(counts.application_unreadable).toBe(1);
  });

  it("a mission already applied to is counted as a duplicate, not added", async () => {
    const w = world([{ id: 1, source: CONFIRMATION }], {
      ask: async () => ONE,
      recordApplication: async () => ({ added: false }),
    });
    const { counts } = await runProspection(w.deps);
    expect(counts).toMatchObject({
      application: 1,
      applications_added: 0,
      applications_duplicate: 1,
    });
  });

  it("a confirmation waits for a model that stops answering, unmarked", async () => {
    const w = world([{ id: 1, source: CONFIRMATION }], {
      ask: async () => {
        throw new ModelDown();
      },
    });
    const { waiting } = await runProspection(w.deps);
    expect(waiting).toBe(true);
    expect(w.applications).toEqual([]);
    expect(w.recorded).toEqual([]);
  });

  it("the journal still gets numbers only", async () => {
    const w = world([{ id: 1, source: CONFIRMATION }], { ask: async () => ONE });
    await runProspection(w.deps);
    expect(JSON.stringify(w.events)).not.toMatch(/Banque|Ingénieur|candidatures@|https/);
  });
});
