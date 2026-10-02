import { describe, expect, it } from "vitest";
import { INTERNAL_STATES, toView } from "./agent-state.ts";

describe("toView", () => {
  it("shows an idle agent as resting, without a note", () => {
    expect(toView("idle")).toEqual({ visual: "resting", note: null });
  });

  it("shows waiting for the local model as resting, not sick", () => {
    expect(toView("waiting_for_local_model")).toEqual({
      visual: "resting",
      note: "waiting_for_mac",
    });
  });

  it.each(["reading", "thinking", "drafting"] as const)("shows %s as working", (state) => {
    expect(toView(state).visual).toBe("working");
  });

  it("shows an error as sick", () => {
    expect(toView("error").visual).toBe("sick");
  });

  it("maps every internal state", () => {
    for (const state of INTERNAL_STATES) {
      expect(() => toView(state)).not.toThrow();
    }
  });
});
