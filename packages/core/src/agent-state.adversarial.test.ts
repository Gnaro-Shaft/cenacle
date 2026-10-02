import { describe, expect, it } from "vitest";
import { toView, UnknownStateError } from "./agent-state.ts";

// These tests try to break toView: nothing unexpected may silently
// become a harmless-looking "resting" agent.
describe("toView — adversarial", () => {
  it.each([
    ["an unknown state", "sleeping"],
    ["a near miss in casing", "Idle"],
    ["surrounding whitespace", " idle "],
    ["an empty string", ""],
    ["null", null],
    ["undefined", undefined],
    ["a number", 0],
    ["an object", { state: "idle" }],
    ["a prototype key", "toString"],
  ])("throws on %s", (_label, value) => {
    expect(() => toView(value)).toThrow(UnknownStateError);
  });

  it("returns a fresh view: mutating one cannot corrupt the next", () => {
    const view = toView("idle") as { visual: string; note: string | null };
    view.visual = "working";
    view.note = "tampered";
    expect(toView("idle")).toEqual({ visual: "resting", note: null });
  });
});
