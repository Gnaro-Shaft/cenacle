// Two cards of the same mission (ADR-0034, § 4): the card the agent left in
// one of its columns says I applied, found at each request from the alerts'
// key — never stored, never a move — and the mails I must read myself are
// counts, nothing more.
import type { Card } from "@cenacle/journal";
import { parseProspectionConfig } from "@cenacle/prospection";
import { describe, expect, it } from "vitest";
import { createProspectionService } from "./prospection-service.ts";

const config = parseProspectionConfig(
  '[reglage]\ntexte_max = 8000\nannonces_max = 5\n[intermediaires]\nesn = ["Grande ESN"]\ntournures = ["esn"]\n',
  '[[plateforme]]\nnom = "P"\ndomaine = "p.example"\nhotes_liens = ["p.example"]\n[profil]\nstack = ["python"]\ntjm_min = 500\nteletravail = ["total"]\n',
);
const KEY = "p|ingenieur ia|banque fictive|lyon";
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
  place: "Lyon",
  link: null,
  note: null,
  column: "alert",
  reason: null,
  decidedBy: "rule",
  toCheck: false,
  duplicateKey: KEY,
  createdAt: new Date(0),
  movedAt: null,
  ...over,
});

function board(cards: Card[], toRead = { floor: 0, applications: 0 }) {
  const moves: unknown[] = [];
  const service = createProspectionService({
    store: {
      cards: async () => cards,
      addByHand: async () => 1,
      move: async (...args) => {
        moves.push(args);
        return null;
      },
      toReadByHand: async () => toRead,
    },
    config: () => config,
    journal: { append: async () => undefined },
  });
  return { service, moves };
}
const appliedOf = async (cards: Card[]) =>
  Object.fromEntries((await board(cards).service.list()).map((c) => [c.id, c.applied]));

describe("the same mission, applied to", () => {
  it("an alert's card points to the confirmation's card; nothing is moved", async () => {
    const b = board([
      card({ id: 1 }),
      card({
        id: 2,
        column: "applied",
        reason: "application_confirmed",
        duplicateKey: `applied|${KEY}`,
      }),
    ]);
    const shown = await b.service.list();
    expect(shown.map((c) => [c.id, c.column, c.applied])).toEqual([
      [1, "alert", 2],
      [2, "applied", null],
    ]);
    expect(b.moves).toEqual([]);
  });

  it.each(["detected", "direct", "profile", "alert"])("in « %s » too", async (column) => {
    expect(
      await appliedOf([
        card({ id: 1, column }),
        card({ id: 2, column: "interview", duplicateKey: `applied|${KEY}` }),
      ]),
    ).toMatchObject({ 1: 2 });
  });

  it.each(["contacted", "dismissed"])(
    "a card in « %s » is not an application: nothing points to it",
    async (column) => {
      expect(
        await appliedOf([card({ id: 1 }), card({ id: 2, column, duplicateKey: `applied|${KEY}` })]),
      ).toEqual({ 1: null, 2: null });
    },
  );

  it("another mission, no key, or a card in my own columns: no pointer", async () => {
    expect(
      await appliedOf([
        card({ id: 1, duplicateKey: "p|autre mission|banque fictive|lyon" }),
        card({ id: 2, duplicateKey: null }),
        card({ id: 3, column: "won", duplicateKey: KEY }),
        card({ id: 4, column: "applied", duplicateKey: `applied|${KEY}` }),
      ]),
    ).toEqual({ 1: null, 2: null, 3: null, 4: null });
  });

  it("a key that only starts like another is not the same mission", async () => {
    expect(
      await appliedOf([
        card({ id: 1, duplicateKey: KEY }),
        card({ id: 2, column: "applied", duplicateKey: `applied|${KEY} bis` }),
      ]),
    ).toEqual({ 1: null, 2: null });
  });
});

describe("the mails I must read myself", () => {
  it("are counts from the store, nothing else", async () => {
    const b = board([], { floor: 2, applications: 1 });
    expect(await b.service.toRead()).toEqual({ floor: 2, applications: 1 });
  });
});
