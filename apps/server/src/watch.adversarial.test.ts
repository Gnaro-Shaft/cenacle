import type { AgentEvent, AgentMessage } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { watchAgent } from "./watch.ts";

const ev = (id: number, type: string): AgentEvent => ({
  id: BigInt(id),
  occurredAt: new Date(0),
  agent: "iris",
  type,
  payload: {},
});

describe("watchAgent — adversarial", () => {
  it("reports an unknown event as a problem and stops watching", async () => {
    const sent: AgentMessage[] = [];
    let polls = 0;
    await watchAgent({
      agent: "iris",
      readAfter: async () => (polls++ === 0 ? [ev(1, "demo")] : []),
      send: async (m) => {
        sent.push(m);
      },
      sleep: async () => {},
      isClosed: () => polls > 5,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "problem", agent: "iris" });
    expect(polls).toBe(1);
  });

  it("does not swallow a database failure", async () => {
    await expect(
      watchAgent({
        agent: "iris",
        readAfter: async () => {
          throw new Error("connection lost");
        },
        send: async () => {},
        sleep: async () => {},
        isClosed: () => false,
      }),
    ).rejects.toThrow("connection lost");
  });
});

describe("HTTP API — adversarial", () => {
  const app = createApp(async () => []);

  it.each(["Iris", "iris;drop", "..%2f..%2fetc", "a".repeat(40)])(
    "refuses the agent name %s",
    async (name) => {
      const response = await app.request(`/api/agents/${name}/stream`);
      expect(response.status).toBe(404);
    },
  );

  it("exposes nothing but the declared routes", async () => {
    expect((await app.request("/api/events")).status).toBe(404);
    expect((await app.request("/")).status).toBe(404);
  });
});
