import { describe, expect, it } from "vitest";
import {
  type AgentEvent,
  applyEvent,
  initialStatus,
  ProjectionError,
  projectStatus,
} from "./agent-status.ts";

const ev = (id: number, type: string, payload: Record<string, unknown> = {}): AgentEvent => ({
  id: BigInt(id),
  occurredAt: new Date(0),
  agent: "iris",
  type,
  payload,
});

// A projection that guesses is worse than one that stops: every case below
// must fail loudly, naming the event, instead of producing a plausible status.
describe("projectStatus — adversarial", () => {
  it.each([
    ["an unknown event type", [ev(1, "demo")]],
    ["an unknown target state", [ev(1, "state.changed", { to: "sleeping" })]],
    ["a missing target state", [ev(1, "state.changed")]],
    ["events out of order", [ev(2, "heartbeat"), ev(1, "heartbeat")]],
    ["a replayed event id", [ev(1, "heartbeat"), ev(1, "heartbeat")]],
    [
      "a proposal created twice",
      [
        ev(1, "proposal.created", { proposalId: "p" }),
        ev(2, "proposal.created", { proposalId: "p" }),
      ],
    ],
    [
      "closing an unknown proposal",
      [ev(1, "proposal.closed", { proposalId: "p", outcome: "accepted" })],
    ],
    [
      "an unknown outcome",
      [
        ev(1, "proposal.created", { proposalId: "p" }),
        ev(2, "proposal.closed", { proposalId: "p", outcome: "maybe" }),
      ],
    ],
    [
      "a proposal id with injected markup",
      [ev(1, "proposal.created", { proposalId: "<img src=x>" })],
    ],
    ["a non-string proposal id", [ev(1, "proposal.created", { proposalId: 42 })]],
  ])("throws on %s", (_label, events) => {
    expect(() => projectStatus("iris", events)).toThrow(ProjectionError);
  });

  it("refuses an event that belongs to another agent", () => {
    const foreign = { ...ev(1, "heartbeat"), agent: "argos" };
    expect(() => projectStatus("iris", [foreign])).toThrow(ProjectionError);
  });

  it("names the faulty event in the error", () => {
    expect(() => projectStatus("iris", [ev(7, "demo")])).toThrow(/#7 \(demo\)/);
  });

  it("never mutates the status it is given", () => {
    const before = initialStatus("iris");
    const snapshot = structuredClone(before);
    applyEvent(before, ev(1, "proposal.created", { proposalId: "p" }));
    expect(before).toEqual(snapshot);
  });

  it("replays 10,000 events quickly", () => {
    const events: AgentEvent[] = [];
    for (let i = 1; i <= 10_000; i++) {
      events.push(ev(i, "state.changed", { to: i % 2 === 0 ? "reading" : "idle" }));
    }
    const started = performance.now();
    expect(projectStatus("iris", events).internal).toBe("reading");
    expect(performance.now() - started).toBeLessThan(500);
  });
});
