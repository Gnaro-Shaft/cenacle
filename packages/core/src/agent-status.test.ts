import { describe, expect, it } from "vitest";
import { type AgentEvent, initialStatus, projectStatus } from "./agent-status.ts";

let nextId = 1n;
const at = (minute: number) => new Date(Date.UTC(2026, 9, 2, 9, minute));
function ev(type: string, payload: Record<string, unknown> = {}, minute = 0): AgentEvent {
  return { id: nextId++, occurredAt: at(minute), agent: "iris", type, payload };
}

describe("projectStatus", () => {
  it("starts idle and resting, with nothing pending", () => {
    expect(projectStatus("iris", [])).toEqual(initialStatus("iris"));
    expect(initialStatus("iris").view.visual).toBe("resting");
  });

  it("follows state changes and remembers since when", () => {
    const status = projectStatus("iris", [
      ev("state.changed", { to: "reading" }, 1),
      ev("state.changed", { to: "thinking" }, 2),
    ]);
    expect(status.internal).toBe("thinking");
    expect(status.view.visual).toBe("working");
    expect(status.since).toEqual(at(2));
  });

  it("shows an error as sick", () => {
    const status = projectStatus("iris", [ev("state.changed", { to: "error" })]);
    expect(status.view.visual).toBe("sick");
  });

  it("counts pending approvals for the bubble, whatever the state", () => {
    const status = projectStatus("iris", [
      ev("proposal.created", { proposalId: "p1" }),
      ev("proposal.created", { proposalId: "p2" }),
      ev("state.changed", { to: "waiting_for_local_model" }),
      ev("proposal.closed", { proposalId: "p1", outcome: "accepted" }),
    ]);
    expect(status.pendingApprovals).toBe(1);
    expect(status.pendingProposalIds).toEqual(["p2"]);
    expect(status.view).toEqual({ visual: "resting", note: "waiting_for_mac" });
  });

  it("ignores neutral events but still records them as applied", () => {
    const heartbeat = ev("heartbeat");
    const status = projectStatus("iris", [heartbeat]);
    expect(status.internal).toBe("idle");
    expect(status.lastEventId).toBe(heartbeat.id);
  });

  it("mail events never change the state: the state events drive the box", () => {
    const status = projectStatus("iris", [
      ev("state.changed", { to: "reading" }),
      ev("mail.fetched", { count: 3, truncated: false, durationMs: 40 }),
      ev("mail.fetch_failed", { reason: "Error" }),
      ev("mail.sorted_by_rules", {
        clients_prospects: 0,
        administratif: 0,
        bruit: 1,
        a_trier: 0,
        remaining: 2,
      }),
      ev("mail.model_sorted", { category: "clients_prospects" }),
      ev("mail.model_waiting", { sorted: 1, waiting: 1 }),
    ]);
    expect(status.internal).toBe("reading");
    expect(status.view.visual).toBe("working");
    expect(status.mail).toEqual({
      clients_prospects: 1,
      administratif: 0,
      bruit: 1,
      a_trier: 0,
      pending: 1,
      waiting: 0,
      due: 0,
    });
  });
});
