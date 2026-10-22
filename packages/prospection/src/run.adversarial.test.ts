// One pass (ADR-0032): every alert ends with an outcome, nothing is silent, a
// forged or foreign mail never reaches the model, the article 9 floor holds,
// and a model that stops answering leaves the rest to read — never marked.
import { describe, expect, it } from "vitest";
import {
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
  readonly events: { type: string; payload?: Record<string, unknown> }[];
}

function world(
  mails: { id: number; auth?: boolean; source?: Buffer; complete?: boolean }[],
  over: Partial<RunDeps> = {},
): World {
  const recorded: World["recorded"] = [];
  const asked: string[] = [];
  const events: World["events"] = [];
  const deps: RunDeps = {
    config: testConfig(),
    journal: { append: async (e) => events.push(e) },
    missionMails: async () => mails.map((m) => ({ id: m.id, senderAuthenticated: m.auth ?? true })),
    unread: async (ids) => ids.filter((id) => !recorded.some((r) => r.id === id)),
    readSources: async (ids) =>
      mails
        .filter((m) => ids.includes(m.id) && m.source !== undefined)
        .map((m) => ({ uid: m.id, source: m.source as Buffer, complete: m.complete ?? true })),
    senderDomain: (s) => /^From:.*@([a-z0-9.-]+)>/im.exec(s.toString("utf8"))?.[1] ?? null,
    sensitive: (text) => /\bhandicap\b/i.test(text),
    ask: async (prompt) => {
      asked.push(prompt);
      return ANSWER;
    },
    isModelUnavailable: (e) => e instanceof ModelDown,
    recordMail: async (id, outcome, cards) => {
      recorded.push({ id, outcome, cards });
      return { added: cards.length, duplicates: 0 };
    },
    purge: async () => 0,
    retentionDays: 60,
    now: () => new Date("2026-10-22T10:00:00Z"),
    nonce: () => "n0",
    ...over,
  };
  return { deps, recorded, asked, events };
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
