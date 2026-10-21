// The review of mesure:rangement: Enter means "right" only when Iris and the
// replay agree; when they differ I must type the box. The changes are counted
// against my verdict, never against either decision.
import { describe, expect, it } from "vitest";
import { changesOf, readAnswer } from "./mesure-revue.ts";

describe("readAnswer", () => {
  it.each([
    ["Enter, no replay: Iris's box", "", undefined, "bruit"],
    ["Enter, both agree", "", "bruit", "bruit"],
    ["Enter, they differ: asked again", "", "administratif", "again"],
    ["spaces only, they differ: asked again", "   ", "administratif", "again"],
    ["a box, they differ", "a", "clients_prospects", "administratif"],
    ["a box in upper case", " C ", "bruit", "clients_prospects"],
    ["À trier", "t", undefined, "a_trier"],
    ["quit", "q", "administratif", "quit"],
    ["an unknown key", "x", undefined, "again"],
    ["a prototype key", "__proto__", undefined, "again"],
    ["a whole word", "bruit", undefined, "again"],
  ] as const)("%s", (_label, raw, replayed, expected) => {
    expect(readAnswer(raw, "bruit", replayed)).toBe(expected);
  });
});

describe("changesOf", () => {
  it("counts what changed, and whether it got better or worse", () => {
    expect(
      changesOf([
        { iris: "clients_prospects", replayed: "bruit", truth: "bruit" }, // better
        { iris: "administratif", replayed: "bruit", truth: "administratif" }, // worse
        { iris: "administratif", replayed: "clients_prospects", truth: "bruit" }, // changed, both wrong
        { iris: "bruit", replayed: "bruit", truth: "administratif" }, // unchanged
      ]),
    ).toEqual({ changed: 3, better: 1, worse: 1 });
  });

  it("nothing judged: nothing changed", () => {
    expect(changesOf([])).toEqual({ changed: 0, better: 0, worse: 0 });
  });
});
