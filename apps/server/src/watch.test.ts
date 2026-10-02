import type { AgentEvent, AgentMessage } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import { watchAgent } from "./watch.ts";

const ev = (id: number, type: string, payload: Record<string, unknown> = {}): AgentEvent => ({
  id: BigInt(id),
  occurredAt: new Date(Date.UTC(2026, 9, 2)),
  agent: "iris",
  type,
  payload,
});

/** Runs the watch over a scripted series of polls. */
async function run(polls: AgentEvent[][]): Promise<AgentMessage[]> {
  const sent: AgentMessage[] = [];
  let poll = 0;
  await watchAgent({
    agent: "iris",
    readAfter: async (_agent, afterId) => (polls[poll] ?? []).filter((e) => e.id > afterId),
    send: async (message) => {
      sent.push(message);
    },
    sleep: async () => {
      poll++;
    },
    isClosed: () => poll >= polls.length,
  });
  return sent;
}

describe("watchAgent", () => {
  it("sends the current status first, then only changes", async () => {
    const sent = await run([
      [ev(1, "state.changed", { to: "thinking" })],
      [],
      [ev(2, "state.changed", { to: "error" })],
    ]);
    expect(sent.map((m) => (m.kind === "status" ? m.visual : m.kind))).toEqual(["working", "sick"]);
  });

  it("sends a resting status for an agent with no events", async () => {
    const [message] = await run([[]]);
    expect(message).toMatchObject({ kind: "status", visual: "resting", pendingApprovals: 0 });
  });

  it("serialises ids and dates as strings", async () => {
    const [message] = await run([[ev(1, "state.changed", { to: "reading" })]]);
    expect(message).toMatchObject({ lastEventId: "1", since: "2026-10-02T00:00:00.000Z" });
  });
});
