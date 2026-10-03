import { describe, expect, it } from "vitest";
import { checkDraft, extractFacts } from "./fact-check.ts";

const values = (text: string) => extractFacts(text).map((f) => `${f.kind}:${f.value}`);

describe("extractFacts", () => {
  it.each([
    ["vendredi à 10 h", ["time:10:00", "weekday:vendredi"]],
    ["à 9h30", ["time:9:30"]],
    ["à partir du 15 décembre", ["date:15-12"]],
    ["le 1er octobre", ["date:1-10"]],
    ["le 15/12/2026", ["date:15-12"]],
    ["environ 3 000 documents", ["number:3000"]],
    ["un TJM de 650 €", ["number:650"]],
    ["deux mois", ["number:2"]],
    ["voir https://x.example/doc.", ["url:https://x.example/doc"]],
    ["écrivez à Bob@Client.example", ["email:bob@client.example"]],
    ["au 06 12 34 56 78", ["phone:0612345678"]],
    ["au +33 6 12 34 56 78", ["phone:0612345678"]],
    ["Bonjour, un point rapide ?", []],
  ])("%j", (text, expected) => {
    expect(values(text).sort()).toEqual([...expected].sort());
  });
});

describe("checkDraft", () => {
  const thread = "Êtes-vous disponible à partir du 15 décembre ? Une prolongation de deux mois.";

  it("accepts facts taken from the conversation, written differently", () => {
    expect(checkDraft("Oui pour le 15/12, et pour 2 mois.", [thread]).ok).toBe(true);
  });

  it("flags every fact the conversation does not contain", () => {
    const check = checkDraft("Oui dès le 1er décembre, TJM 650 €, pour trois mois.", [thread]);
    expect(check.unsupported.map((f) => `${f.kind}:${f.value}`).sort()).toEqual(
      ["date:1-12", "number:3", "number:650"].sort(),
    );
  });
});
