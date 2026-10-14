// How an agent shows (2026-10-14): every state has its ring and its words,
// so colour is never the only sign; drafts waiting on me turn rest and work
// red, never hide a sickness or an offline agent.
import { describe, expect, it } from "vitest";
import { presence, RINGS, type Visual } from "./presence.ts";

const VISUALS: readonly Visual[] = ["resting", "working", "sick", "offline"];

describe("an agent's presence", () => {
  it.each([
    ["resting", 0, "repos", "au repos"],
    ["working", 0, "travail", "au travail"],
    ["sick", 0, "malade", "malade"],
    ["offline", 0, "absent", "hors ligne"],
    ["resting", 1, "accord", "attend ton accord"],
    ["working", 5, "accord", "attend ton accord"],
    ["sick", 3, "malade", "malade"],
    ["offline", 2, "absent", "hors ligne"],
  ] as const)("%s with %i draft(s): ring %s, said « %s »", (visual, pending, ring, label) => {
    expect(presence(visual, pending)).toEqual({ ring, label });
  });

  it("every state and count has words, and a ring from the closed list", () => {
    for (const visual of VISUALS) {
      for (const pending of [0, 1, 99]) {
        const p = presence(visual, pending);
        expect(p.label.trim().length).toBeGreaterThan(0);
        expect(RINGS).toContain(p.ring);
      }
    }
  });

  it("a negative or odd count of drafts never turns a state red", () => {
    expect(presence("resting", -1).ring).toBe("repos");
    expect(presence("working", Number.NaN).ring).toBe("travail");
  });

  it("two different states never read the same", () => {
    const labels = new Set(RINGS.map((r) => r));
    const said = new Set(
      [
        presence("resting", 0),
        presence("working", 0),
        presence("resting", 1),
        presence("sick", 0),
        presence("offline", 0),
      ].map((p) => p.label),
    );
    expect(said.size).toBe(labels.size);
  });
});
