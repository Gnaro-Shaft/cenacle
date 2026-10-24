// The board's routes (ADR-0032, points 15 to 17): only the page, with the
// token of this run, from this machine, may list, add or move a card. A
// refusal is the code's own words; anything else says "internal error" and
// nothing of what failed. The journal gets columns, never which card.
import type { Card, NewCard } from "@cenacle/journal";
import { parseProspectionConfig } from "@cenacle/prospection";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { defaultGuardConfig } from "./guard.ts";
import {
  BoardError,
  type CardView,
  createProspectionService,
  type ProspectionService,
} from "./prospection-service.ts";

const PAGE_PASS = "fictive-page-pass-of-this-run-xxxxxxxxxxxxxx";

function setup(over: Partial<ProspectionService> = {}) {
  const calls: string[] = [];
  const service: ProspectionService = {
    list: async () => [],
    toRead: async () => ({ floor: 0, applications: 0 }),
    add: async (input) => {
      calls.push(`add ${JSON.stringify(input)}`);
      return { id: 1 } as CardView;
    },
    move: async (id, column) => {
      calls.push(`move ${id} ${String(column)}`);
      if (id === 9) throw new BoardError("cette carte n'existe plus");
      if (id === 13) throw new Error("connect ECONNREFUSED jean@corp.example Banque Fictive");
    },
    ...over,
  };
  const app = createApp({
    readAfter: async () => [],
    guard: defaultGuardConfig(PAGE_PASS),
    proposals: {} as never,
    prospection: service,
  });
  return { app, calls };
}

const PAGE = {
  host: "127.0.0.1:5173",
  origin: "http://127.0.0.1:5173",
  authorization: `Bearer ${PAGE_PASS}`,
  "content-type": "application/json",
};
const post = (headers: Record<string, string> = PAGE, body = "{}") => ({
  method: "POST",
  headers,
  body,
});
const without = (key: keyof typeof PAGE) =>
  Object.fromEntries(Object.entries(PAGE).filter(([k]) => k !== key));
const MOVE = "/api/prospection/cartes/4/deplacer";

describe("board API — who may act", () => {
  it("the page with the token lists the cards and the mails to read myself", async () => {
    const { app } = setup({ toRead: async () => ({ floor: 1, applications: 2 }) });
    const r = await app.request("/api/prospection/cartes", { headers: PAGE });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ cards: [], toRead: { floor: 1, applications: 2 } });
  });

  it("the page with the token can move a card", async () => {
    const { app, calls } = setup();
    const r = await app.request(MOVE, post(PAGE, '{"colonne":"applied"}'));
    expect(r.status).toBe(200);
    expect(calls).toEqual(["move 4 applied"]);
  });

  it.each([
    ["no token", without("authorization"), 401],
    [
      "another token of the same length",
      { ...PAGE, authorization: `Bearer ${"x".repeat(PAGE_PASS.length)}` },
      401,
    ],
    ["another origin (a page elsewhere)", { ...PAGE, origin: "https://attacker.test" }, 403],
    ["no origin", without("origin"), 403],
    [
      "a form post (no JSON)",
      { ...PAGE, "content-type": "application/x-www-form-urlencoded" },
      415,
    ],
    ["another host (DNS rebinding)", { ...PAGE, host: "attacker.test:5173" }, 421],
  ])("refuses %s, before the service", async (_label, headers, status) => {
    for (const path of [MOVE, "/api/prospection/cartes"]) {
      const { app, calls } = setup();
      const r = await app.request(
        path,
        post(headers as Record<string, string>, '{"colonne":"won"}'),
      );
      expect(r.status).toBe(status);
      expect(calls).toEqual([]);
    }
  });

  it("listing needs the token too", async () => {
    const { app } = setup();
    const r = await app.request("/api/prospection/cartes", { headers: without("authorization") });
    expect(r.status).toBe(401);
  });

  it.each(["0", "-1", "1.5", "abc", "1e3", "99999999999999999"])(
    "an id like %s names no card",
    async (id) => {
      const { app, calls } = setup();
      const r = await app.request(`/api/prospection/cartes/${id}/deplacer`, post());
      expect(r.status).toBe(404);
      expect(calls).toEqual([]);
    },
  );

  it.each([
    ["broken JSON", "{oops", 400],
    ["an array", "[1]", 400],
    ["too large", JSON.stringify({ note: "x".repeat(20_000) }), 413],
  ])("refuses %s", async (_label, body, status) => {
    const { app, calls } = setup();
    expect((await app.request("/api/prospection/cartes", post(PAGE, body))).status).toBe(status);
    expect(calls).toEqual([]);
  });

  it("a refusal of the code is shown as is; any other failure says nothing", async () => {
    const { app } = setup();
    const refused = await app.request("/api/prospection/cartes/9/deplacer", post());
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "cette carte n'existe plus" });
    const failed = await app.request("/api/prospection/cartes/13/deplacer", post());
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toMatch(/jean|Banque|ECONNREFUSED/);
  });
});

describe("board service — the code decides, the journal gets columns", () => {
  const config = parseProspectionConfig(
    '[reglage]\ntexte_max = 8000\nannonces_max = 5\n[intermediaires]\nesn = ["Grande ESN"]\ntournures = ["esn"]\n',
    '[[plateforme]]\nnom = "P"\ndomaine = "p.example"\nhotes_liens = ["p.example"]\n[profil]\nstack = ["python"]\ntjm_min = 500\nteletravail = ["total"]\n',
  );
  function service() {
    const events: { type: string; payload?: Record<string, unknown> }[] = [];
    const added: NewCard[] = [];
    const moves: [number, string][] = [];
    const card = (over: Partial<Card>): Card => ({
      id: 1,
      source: "mail",
      platform: "P",
      title: "Ingénieur IA",
      company: "Banque Fictive",
      intermediary: "direct",
      stack: ["Python"],
      rate: null,
      remote: "total",
      place: null,
      link: null,
      note: null,
      column: "alert",
      reason: null,
      decidedBy: "rule",
      toCheck: true,
      duplicateKey: null,
      createdAt: new Date(0),
      movedAt: null,
      ...over,
    });
    const s = createProspectionService({
      store: {
        cards: async () => [
          card({ id: 1, link: "https://p.example/m/1" }),
          card({ id: 2, link: "https://attacker.test/x" }),
          card({ id: 3, source: "me", platform: null, link: "https://ailleurs.test/m" }),
        ],
        toReadByHand: async () => ({ floor: 0, applications: 0 }),
        addByHand: async (c) => {
          added.push(c);
          return 7;
        },
        move: async (id, column) => {
          moves.push([id, column]);
          return id === 404 ? null : "alert";
        },
      },
      config: () => config,
      journal: { append: async (e) => events.push(e) },
    });
    return { s, events, added, moves };
  }

  it("a mail's link shows only on a declared host; mine, any https", async () => {
    const links = (await service().s.list()).map((c) => c.link);
    expect(links).toEqual(["https://p.example/m/1", null, "https://ailleurs.test/m"]);
  });

  it("a card by hand is checked, sorted and stored as mine; the journal gets its column", async () => {
    const { s, added, events } = service();
    const view = await s.add({
      intitule: "Mission IA",
      intermediaire: "direct",
      stack: ["Python"],
      teletravail: "total",
    });
    expect(added[0]).toMatchObject({ source: "me", platform: null, duplicateKey: null });
    expect(view).toMatchObject({ id: 7, column: "alert", source: "me" });
    expect(events).toEqual([
      { agent: "prospection", type: "prospection.card_added", payload: { column: "alert" } },
    ]);
  });

  it("a bad form is refused with the code's words, nothing stored", async () => {
    const { s, added } = service();
    await expect(s.add({ intitule: "x", lien: "javascript:alert(1)" })).rejects.toThrow(BoardError);
    expect(added).toEqual([]);
  });

  it.each([["ailleurs"], [""], [null], [3], ["ALERT"]])(
    "a move to %j is refused before the store",
    async (column) => {
      const { s, moves } = service();
      await expect(s.move(1, column)).rejects.toThrow(BoardError);
      expect(moves).toEqual([]);
    },
  );

  it("a move is journaled from which column to which, never which card", async () => {
    const { s, events } = service();
    await s.move(5, "won");
    expect(events).toEqual([
      {
        agent: "prospection",
        type: "prospection.card_moved",
        payload: { from: "alert", to: "won" },
      },
    ]);
    await expect(s.move(404, "won")).rejects.toThrow(BoardError);
  });

  it("unreadable settings are said, never guessed", async () => {
    const s = createProspectionService({
      store: {
        cards: async () => [],
        addByHand: async () => 1,
        move: async () => null,
        toReadByHand: async () => ({ floor: 0, applications: 0 }),
      },
      config: () => parseProspectionConfig("[reglage", ""),
      journal: { append: async () => undefined },
    });
    await expect(s.list()).rejects.toThrow(BoardError);
  });
});
