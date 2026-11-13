import { type AgentEvent, type AgentMessage, INTERNAL_STATES } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { defaultGuardConfig } from "./guard.ts";
import { watchAgent, watchAgents } from "./watch.ts";

const ev = (id: number, type: string, agent = "iris"): AgentEvent => ({
  id: BigInt(id),
  occurredAt: new Date(0),
  agent,
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

describe("watchAgents — the team on one stream (2026-10-26)", () => {
  it("each agent's first status; one agent's problem stops it alone, the others go on", async () => {
    const sent: AgentMessage[] = [];
    const reads: string[] = [];
    let rounds = 0;
    await watchAgents({
      agents: ["iris", "operateur", "cto"],
      readAfter: async (agent, after) => {
        reads.push(agent);
        if (agent === "operateur" && after === 0n) return [ev(1, "demo", "operateur")];
        if (agent === "cto" && rounds === 2 && after === 0n) return [ev(2, "heartbeat", "cto")];
        return [];
      },
      send: async (m) => {
        sent.push(m);
      },
      sleep: async () => {
        rounds++;
      },
      isClosed: () => rounds >= 3,
    });
    expect(sent.slice(0, 3).map((m) => [m.kind, m.agent])).toEqual([
      ["status", "iris"],
      ["problem", "operateur"],
      ["status", "cto"],
    ]);
    // The broken agent is never read again; the others are, every round.
    expect(reads.filter((a) => a === "operateur")).toHaveLength(1);
    expect(reads.filter((a) => a === "iris")).toHaveLength(3);
    // A later event of another agent still comes through.
    expect(sent.at(-1)).toMatchObject({ kind: "status", agent: "cto", lastEventId: "2" });
  });

  it("every agent stopped on a problem: the watch ends by itself", async () => {
    const sent: AgentMessage[] = [];
    let sleeps = 0;
    await watchAgents({
      agents: ["iris", "cto"],
      readAfter: async (agent) => [ev(agent === "iris" ? 1 : 2, "demo", agent)],
      send: async (m) => {
        sent.push(m);
      },
      sleep: async () => {
        sleeps++;
      },
      isClosed: () => false,
    });
    expect(sent.map((m) => m.kind)).toEqual(["problem", "problem"]);
    expect(sleeps).toBe(0);
  });

  it("does not swallow a database failure, whichever agent hits it", async () => {
    await expect(
      watchAgents({
        agents: ["iris", "cto"],
        readAfter: async (agent) => {
          if (agent === "cto") throw new Error("connection lost");
          return [];
        },
        send: async () => {},
        sleep: async () => {},
        isClosed: () => false,
      }),
    ).rejects.toThrow("connection lost");
  });
});

describe("HTTP API — adversarial", () => {
  const app = createApp({
    readAfter: async () => [],
    guard: defaultGuardConfig("t".repeat(43)),
    proposals: {
      list: async () => [],
      edit: async () => {},
      accept: async () => {},
      refuse: async () => {},
      cancel: async () => {},
    },
  });
  const local = { headers: { host: "127.0.0.1:8787" } };

  it.each(["Iris", "iris;drop", "..%2f..%2fetc", "a".repeat(40)])(
    "refuses the agent name %s",
    async (name) => {
      const response = await app.request(`/api/agents/${name}/stream`, local);
      expect(response.status).toBe(404);
    },
  );

  it.each([
    ["no list", "/api/agents/stream"],
    ["an empty list", "/api/agents/stream?agents="],
    ["a trailing comma", "/api/agents/stream?agents=iris,"],
    ["a bad name", "/api/agents/stream?agents=iris,Cto"],
    ["an injected name", "/api/agents/stream?agents=iris;drop"],
    ["a duplicate", "/api/agents/stream?agents=iris,cto,iris"],
    [
      "thirteen agents",
      `/api/agents/stream?agents=${Array.from({ length: 13 }, (_, i) => `a${i}`).join(",")}`,
    ],
  ])("refuses the team stream with %s", async (_, url) => {
    expect((await app.request(url, local)).status).toBe(404);
  });

  it("the team stream: one Server-Sent Events response for six agents", async () => {
    const response = await app.request(
      "/api/agents/stream?agents=iris,cto,prospection,securite,operateur,sentinel",
      local,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await response.body?.cancel();
  });

  it("the team stream keeps the host guard", async () => {
    const away = { headers: { host: "evil.example:8787" } };
    expect((await app.request("/api/agents/stream?agents=iris", away)).status).not.toBe(200);
  });

  it("exposes nothing but the declared routes", async () => {
    expect((await app.request("/api/events", local)).status).toBe(404);
    expect((await app.request("/", local)).status).toBe(404);
  });
});

// The stream needs no token (app.ts): it must never carry mail content
// (ADR-0005). Pinned here: the keys it may send, and payload extras dropped.
describe("the status stream carries states and counts, never content (lot B, 13/11)", () => {
  const STATUS_KEYS = [
    "agent",
    "internal",
    "kind",
    "lastEventId",
    "mail",
    "note",
    "pendingApprovals",
    "since",
    "visual",
  ];
  const LEAK = "claire.dubois@client.example";
  const rich = (id: number, type: string, payload: Record<string, unknown>): AgentEvent => ({
    ...ev(id, type),
    payload: { ...payload, subject: `Devis ${LEAK}`, from: LEAK, draft: `Bonjour ${LEAK}` },
  });

  it("a status message holds only its known keys, and no payload extra", async () => {
    const sent: AgentMessage[] = [];
    let polls = 0;
    await watchAgent({
      agent: "iris",
      readAfter: async () =>
        polls++ === 0
          ? [
              rich(1, "state.changed", { to: "reading" }),
              rich(2, "proposal.created", { proposalId: "p-1" }),
              rich(3, "mail.sender_auth", { mails: 2, trusted: 2 }),
              rich(4, "mail.totals", {
                clients_prospects: 1,
                administratif: 0,
                bruit: 3,
                missions: 0,
                a_trier: 0,
                pending: 0,
                waiting: 0,
                due: 0,
              }),
            ]
          : [],
      send: async (m) => {
        sent.push(m);
      },
      sleep: async () => {},
      isClosed: () => polls > 1,
    });
    expect(sent.length).toBeGreaterThan(0);
    for (const m of sent) {
      expect(m.kind).toBe("status");
      expect(Object.keys(m).sort()).toEqual(STATUS_KEYS);
      expect(JSON.stringify(m)).not.toContain(LEAK);
      if (m.kind !== "status") continue;
      // Values too: enums, counts and dates only — no free text can ride along.
      expect(m.agent).toBe("iris");
      expect(["resting", "working", "sick"]).toContain(m.visual);
      expect(INTERNAL_STATES).toContain(m.internal);
      expect([null, "waiting_for_mac", "purge_failed", "auth_missing"]).toContain(m.note);
      expect(m.since === null || !Number.isNaN(Date.parse(m.since))).toBe(true);
      expect(Number.isSafeInteger(m.pendingApprovals)).toBe(true);
      expect(m.lastEventId === null || /^\d+$/.test(m.lastEventId)).toBe(true);
      for (const n of Object.values(m.mail ?? {})) expect(Number.isSafeInteger(n)).toBe(true);
    }
    expect(sent.at(-1)).toMatchObject({ pendingApprovals: 1, internal: "reading" });
  });
});

describe("a problem on the token-less stream quotes no value (lot C, 13/11)", () => {
  it("a malformed payload: the agent is shown sick, the message says what, not the value", async () => {
    const sent: AgentMessage[] = [];
    let polls = 0;
    const leak = "claire.dubois@client.example";
    await watchAgent({
      agent: "iris",
      readAfter: async () =>
        polls++ === 0 ? [{ ...ev(1, "state.changed"), payload: { to: `Devis ${leak}` } }] : [],
      send: async (m) => {
        sent.push(m);
      },
      sleep: async () => {},
      isClosed: () => polls > 3,
    });
    expect(sent).toEqual([
      {
        kind: "problem",
        agent: "iris",
        message: "Event #1 (state.changed): unknown target state (a string)",
      },
    ]);
  });
});
