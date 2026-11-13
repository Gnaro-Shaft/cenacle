// The rights of a person named on a prospection card (lot D, 13/11): found,
// shown, given if asked, erased only on a typed confirmation; journaled as
// counts, never who. Fictional cards only.
import type { Card } from "@cenacle/journal";
import { describe, expect, it } from "vitest";
import { cardsExport, cardsRights } from "./person-cards.ts";

const NOW = new Date("2026-11-13T10:00:00Z");
const card = (id: number, over: Partial<Card> = {}): Card =>
  ({
    id,
    source: "mail",
    platform: "Plateforme fictive",
    title: "Ingénieur IA",
    company: "Banque Fictive",
    intermediary: "direct",
    stack: [],
    rate: null,
    remote: "total",
    place: "Lyon",
    link: "https://plateforme.example/m/1",
    note: null,
    column: "alert",
    reason: null,
    decidedBy: "model",
    toCheck: false,
    duplicateKey: null,
    createdAt: NOW,
    movedAt: null,
    ...over,
  }) as unknown as Card;

function setup(answers: string[], found: Card[], write = false) {
  const asked: string[] = [];
  const erased: number[] = [];
  const records: [string, number][] = [];
  const logs: string[] = [];
  const written: string[] = [];
  let i = 0;
  const deps = {
    ask: async (q: string) => {
      asked.push(q);
      return answers[i++] ?? "";
    },
    mentioning: async () => found,
    erase: async (id: number) => {
      erased.push(id);
      return true;
    },
    record: async (type: "person.exported" | "person.erased", n: number) => {
      records.push([type, n]);
    },
    write: write ? (t: string) => written.push(t) : null,
    log: (l: string) => logs.push(l),
  };
  return { deps, asked, erased, records, logs, written };
}

describe("a person's cards", () => {
  it("found and shown; kept when the confirmation is not typed", async () => {
    const s = setup(["Jean Valjean", ""], [card(3), card(9)]);
    await cardsRights(s.deps, NOW);
    expect(s.logs.filter((l) => l.startsWith("  n°"))).toHaveLength(2);
    expect(s.erased).toEqual([]);
    // A look-up is not an export: nothing journaled.
    expect(s.records).toEqual([]);
  });

  it.each(["oui", "effacer", "EFFACER ", "yes"])(
    "erased only on exactly EFFACER, not %j",
    async (typed) => {
      const s = setup(["Jean Valjean", typed.trim() === "EFFACER" ? "nope" : typed], [card(3)]);
      await cardsRights(s.deps, NOW);
      expect(s.erased).toEqual([]);
    },
  );

  it("erased on EFFACER, every card, and journaled as a count", async () => {
    const s = setup(["Jean Valjean", "EFFACER"], [card(3), card(9)]);
    await cardsRights(s.deps, NOW);
    expect(s.erased).toEqual([3, 9]);
    expect(s.records).toEqual([["person.erased", 2]]);
    expect(JSON.stringify(s.records)).not.toContain("Valjean");
  });

  it.each(["", "  ", "ab", " a b "])("a name too short (%j) does nothing", async (name) => {
    const s = setup([name], [card(1)]);
    await expect(cardsRights(s.deps, NOW)).rejects.toThrow(/trop court/);
    expect(s.records).toEqual([]);
  });

  it("no card: said, nothing asked to erase", async () => {
    const s = setup(["Jean Valjean"], []);
    await cardsRights(s.deps, NOW);
    expect(s.asked).toHaveLength(1);
    expect(s.logs).toEqual(["ℹ aucune carte ne porte ce nom"]);
  });

  it("the export: the card in the notice's words, nothing of the agent's", async () => {
    const s = setup(["Jean Valjean", ""], [card(3, { note: "Rappeler Jean Valjean" })], true);
    await cardsRights(s.deps, NOW);
    expect(s.records).toEqual([["person.exported", 1]]);
    const doc = JSON.parse(s.written[0] ?? "{}");
    expect(doc).toEqual(cardsExport([card(3, { note: "Rappeler Jean Valjean" })], NOW));
    expect(Object.keys(doc.cartes[0]).sort()).toEqual(
      ["creee_le", "entreprise", "intitule", "lien", "lieu", "note"].sort(),
    );
  });

  it("an erasure that fails halfway: what is gone is journaled, the failure thrown", async () => {
    const s = setup(["Jean Valjean", "EFFACER"], [card(3), card(9)]);
    s.deps.erase = async (id: number) => {
      if (id === 9) throw new Error("connection lost");
      s.erased.push(id);
      return true;
    };
    await expect(cardsRights(s.deps, NOW)).rejects.toThrow("connection lost");
    expect(s.records).toEqual([["person.erased", 1]]);
    expect(s.logs.at(-1)).toBe("⚠ 1 carte(s) effacée(s) sur 2");
  });
});
