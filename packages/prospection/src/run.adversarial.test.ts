// One pass (ADR-0032): every alert ends with an outcome, nothing is silent, a
// forged or foreign mail never reaches the model, the article 9 floor holds,
// and a model that stops answering leaves the rest to read — never marked.
import { describe, expect, it } from "vitest";
import {
  type ApplicationToKeep,
  type CardToKeep,
  MAILS_PER_PASS,
  type Outcome,
  type RunDeps,
  runProspection,
} from "./run.ts";
import { testConfig } from "./test-config.ts";

class ModelDown extends Error {}

const source = (from: string, html: string) =>
  Buffer.from(
    `From: Alertes <${from}>\r\nSubject: Missions\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}`,
    "utf8",
  );
const ALERT = source(
  "alertes@plateforme.example",
  '<p>Ingénieur IA, Banque Fictive, Lyon <a href="https://plateforme.example/m/1">voir</a></p>',
);
const ANSWER = JSON.stringify([
  {
    intitule: "Ingénieur IA",
    entreprise: "Banque Fictive",
    intermediaire: "direct",
    stack: ["Python"],
    tjm: [600, 700],
    teletravail: "total",
    lieu: "Lyon",
    lien: 1,
  },
]);

interface World {
  readonly deps: RunDeps;
  readonly recorded: { id: number; outcome: Outcome; cards: readonly CardToKeep[] }[];
  readonly asked: string[];
  readonly systems: string[];
  readonly applications: { id: number; card: ApplicationToKeep }[];
  readonly events: { type: string; payload?: Record<string, unknown> }[];
}

function world(
  mails: { id: number; auth?: boolean; source?: Buffer; complete?: boolean }[],
  over: Partial<RunDeps> = {},
): World {
  const recorded: World["recorded"] = [];
  const asked: string[] = [];
  const systems: string[] = [];
  const applications: World["applications"] = [];
  const events: World["events"] = [];
  const deps: RunDeps = {
    config: testConfig(),
    journal: { append: async (e) => events.push(e) },
    missionMails: async () => mails.map((m) => ({ id: m.id, senderAuthenticated: m.auth ?? true })),
    unread: async (ids) =>
      ids.filter(
        (id) => !recorded.some((r) => r.id === id) && !applications.some((a) => a.id === id),
      ),
    readSources: async (ids) =>
      mails
        .filter((m) => ids.includes(m.id) && m.source !== undefined)
        .map((m) => ({ uid: m.id, source: m.source as Buffer, complete: m.complete ?? true })),
    senderAddress: (s) => /^From:.*<([^>]+)>/im.exec(s.toString("utf8"))?.[1] ?? null,
    sensitive: (text) => /\bhandicap\b/i.test(text),
    ask: async (prompt, system) => {
      asked.push(prompt);
      systems.push(system);
      return ANSWER;
    },
    isModelUnavailable: (e) => e instanceof ModelDown,
    recordMail: async (id, outcome, cards) => {
      recorded.push({ id, outcome, cards });
      return { added: cards.length, duplicates: 0 };
    },
    recordApplication: async (id, card) => {
      applications.push({ id, card });
      return { added: true };
    },
    purge: async () => 0,
    retentionDays: 60,
    now: () => new Date("2026-10-22T10:00:00Z"),
    nonce: () => "n0",
    ...over,
  };
  return { deps, recorded, asked, systems, applications, events };
}

describe("a pass — each alert ends with an outcome", () => {
  it("reads an authenticated alert of a declared platform into a card", async () => {
    const w = world([{ id: 1, source: ALERT }]);
    const { counts } = await runProspection(w.deps);
    expect(w.recorded).toHaveLength(1);
    expect(w.recorded[0]).toMatchObject({ id: 1, outcome: "read" });
    expect(w.recorded[0]?.cards[0]).toMatchObject({
      platform: "Plateforme fictive",
      column: "alert",
      link: "https://plateforme.example/m/1",
    });
    expect(counts).toMatchObject({ read: 1, offers: 1, alert: 1, added: 1 });
  });

  it.each<[string, { auth?: boolean; source?: Buffer; complete?: boolean }, Outcome]>([
    ["an unauthenticated sender", { auth: false, source: ALERT }, "unauthenticated"],
    [
      "an undeclared platform",
      { source: source("x@autre.example", "<p>Mission</p>") },
      "not_platform",
    ],
    [
      "a look-alike sender domain",
      { source: source("a@plateforme.example.attacker.test", "x") },
      "not_platform",
    ],
    ["a mail too big to read whole", { source: ALERT, complete: false }, "too_big"],
    ["an empty mail", { source: source("alertes@plateforme.example", "  ") }, "unparsable"],
    [
      "a mail the article 9 floor sets aside",
      {
        source: source(
          "alertes@plateforme.example",
          "<p>Poste ouvert aux personnes en situation de handicap</p>",
        ),
      },
      "floor",
    ],
  ])("%s is never shown to the model", async (_label, mail, outcome) => {
    const w = world([{ id: 7, ...mail }]);
    await runProspection(w.deps);
    expect(w.asked).toEqual([]);
    expect(w.recorded).toEqual([{ id: 7, outcome, cards: [] }]);
  });

  it("an answer that is not the schema ends as unparsable, counted, never retried forever", async () => {
    const w = world([{ id: 1, source: ALERT }], { ask: async () => "Je ne peux pas." });
    const { counts } = await runProspection(w.deps);
    expect(w.recorded[0]?.outcome).toBe("unparsable");
    expect(counts.unparsable).toBe(1);
  });

  it("no mission in the answer: marked read with no card, said as such", async () => {
    const w = world([{ id: 1, source: ALERT }], { ask: async () => "[]" });
    expect((await runProspection(w.deps)).counts.no_offer).toBe(1);
  });

  it("a mail gone from the server is counted, and not marked (Iris forgets it)", async () => {
    const w = world([{ id: 3 }]);
    const { counts } = await runProspection(w.deps);
    expect(counts.gone).toBe(1);
    expect(w.recorded).toEqual([]);
  });

  it("a mail already read is never read again", async () => {
    const w = world([{ id: 1, source: ALERT }]);
    await runProspection(w.deps);
    await runProspection(w.deps);
    expect(w.asked).toHaveLength(1);
  });
});

describe("a pass — the model", () => {
  it("stops when the model stops: the rest stays unread, the wait is journaled", async () => {
    let calls = 0;
    const w = world(
      [1, 2, 3].map((id) => ({ id, source: ALERT })),
      {
        ask: async () => {
          calls++;
          if (calls === 2) throw new ModelDown();
          return ANSWER;
        },
      },
    );
    const { waiting } = await runProspection(w.deps);
    expect(waiting).toBe(true);
    expect(w.recorded.map((r) => r.id)).toEqual([1]);
    expect(w.events.map((e) => e.type)).toContain("prospection.model_waiting");
    expect(w.events).toContainEqual(
      expect.objectContaining({
        type: "state.changed",
        payload: { to: "waiting_for_local_model" },
      }),
    );
  });

  it("any other error is a bug and is thrown, never swallowed", async () => {
    const w = world([{ id: 1, source: ALERT }], {
      ask: async () => {
        throw new TypeError("bug");
      },
    });
    await expect(runProspection(w.deps)).rejects.toThrow(TypeError);
  });

  it("the alert reaches the model inside the fence, its link as a marker only", async () => {
    const w = world([{ id: 1, source: ALERT }]);
    await runProspection(w.deps);
    expect(w.asked[0]).toContain("<<<ALERTE n0>>>");
    expect(w.asked[0]).toContain("[L1]");
    expect(w.asked[0]).not.toContain("https://");
  });
});

describe("a pass — bounds and the journal", () => {
  it(`reads ${MAILS_PER_PASS} alerts at most, and says how many are left`, async () => {
    const w = world(
      Array.from({ length: MAILS_PER_PASS + 5 }, (_, i) => ({ id: i + 1, source: ALERT })),
    );
    const { counts } = await runProspection(w.deps);
    expect(w.recorded).toHaveLength(MAILS_PER_PASS);
    expect(counts.left).toBe(5);
  });

  it("purges cards older than the retention, from now", async () => {
    let cutoff: Date | undefined;
    const w = world([], {
      purge: async (c) => {
        cutoff = c;
        return 2;
      },
    });
    expect((await runProspection(w.deps)).counts.purged).toBe(2);
    expect(cutoff?.toISOString()).toBe("2026-08-23T10:00:00.000Z");
  });

  it("the journal gets numbers only: no title, company, link or domain", async () => {
    const w = world([{ id: 1, source: ALERT }]);
    await runProspection(w.deps);
    const passed = w.events.find((e) => e.type === "prospection.passed");
    expect(Object.values(passed?.payload ?? {}).every((v) => typeof v === "number")).toBe(true);
    expect(JSON.stringify(w.events)).not.toMatch(/Banque|Ingénieur|plateforme|https/);
  });
});

// ADR-0034: a confirmation is told by its exact, declared, authenticated
// address — never by its words — and becomes one card in "applied", or none.
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
