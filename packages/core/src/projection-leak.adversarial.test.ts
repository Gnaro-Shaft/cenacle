// A projection error says which event and what is wrong with it — never the
// value (lot C, 13/11): its message reaches the page's status stream, which
// needs no token (ADR-0005), and a payload may hold data by mistake.
import { describe, expect, it } from "vitest";
import { type AgentEvent, applyEvent, initialStatus, ProjectionError } from "./agent-status.ts";

const LEAK = "claire.dubois@client.example";
const ev = (type: string, payload: Record<string, unknown>, agent = "iris"): AgentEvent => ({
  id: 7n,
  occurredAt: new Date(0),
  agent,
  type,
  payload,
});

function messageOf(event: AgentEvent): string {
  // One mail pending, so that a sort can be judged on its category.
  const fetched = applyEvent(initialStatus("iris"), {
    ...ev("mail.fetched", { count: 1 }),
    id: 1n,
  });
  try {
    applyEvent(fetched, event);
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectionError);
    return (error as Error).message;
  }
  throw new Error("the event was projected");
}

describe("a projection error never quotes a value", () => {
  it.each([
    ["a target state", ev("state.changed", { to: LEAK }), "unknown target state (a string)"],
    [
      "a proposal id",
      ev("proposal.created", { proposalId: LEAK }),
      "invalid proposalId (a string)",
    ],
    [
      "an outcome",
      ev("proposal.closed", { proposalId: "p-1", outcome: LEAK }),
      "unknown outcome (a string)",
    ],
    ["a count", ev("mail.sender_auth", { mails: LEAK, trusted: 0 }), "invalid mails (a string)"],
    [
      "a total",
      ev("mail.totals", { clients_prospects: [LEAK] }),
      "invalid clients_prospects (an array)",
    ],
    ["a category", ev("mail.model_sorted", { category: LEAK }), "unknown category (a string)"],
  ])("%s", (_label, event, said) => {
    const message = messageOf(event);
    expect(message).toContain(said);
    expect(message).not.toContain("claire");
    expect(message).toMatch(/^Event #7 \([a-z_.]+\): /);
  });

  it("an event type or agent that is not an identifier is said as ?", () => {
    expect(messageOf(ev(`note ${LEAK}`, {}))).toBe(
      "Event #7 (?): unknown event type — declare it before using it",
    );
    const foreign = messageOf(ev("heartbeat", {}, LEAK));
    expect(foreign).toBe('Event #7 (heartbeat): belongs to "?", not "iris"');
  });

  it("an identifier is still said, so that the cause can be found", () => {
    expect(messageOf(ev("mail.brand_new", {}))).toBe(
      "Event #7 (mail.brand_new): unknown event type — declare it before using it",
    );
  });
});
