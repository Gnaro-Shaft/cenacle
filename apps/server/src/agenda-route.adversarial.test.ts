// The agenda's route (ADR-0042, point 1): only the page with this run's token
// reads it; the window is checked before any reading; the answer is never
// cached; a fault inside leaks nothing.
import type { AgendaView } from "@cenacle/agenda";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { defaultGuardConfig } from "./guard.ts";
import type { ProposalsService } from "./proposals-service.ts";

const TOKEN = "s3cr3t-token-of-this-run-xxxxxxxxxxxxxxxxxx";
const none = async () => {
  throw new Error("not used");
};
const proposals: ProposalsService = {
  list: async () => [],
  edit: none,
  accept: none,
  refuse: none,
  cancel: none,
};
const VIEW: AgendaView = {
  read: "ok",
  from: "2026-11-17",
  days: 7,
  accounts: [{ name: "pro", state: "ok" }],
  events: [{ kind: "heure", title: "Point projet", start: 1, end: 2, account: "pro" }],
  setAside: [],
};

function setup(agenda?: (days: number) => Promise<AgendaView>) {
  const asked: number[] = [];
  const logs: string[] = [];
  const app = createApp({
    readAfter: async () => [],
    guard: defaultGuardConfig(TOKEN),
    proposals,
    log: (line) => logs.push(line),
    ...(agenda === undefined
      ? {}
      : {
          agenda: async (days: number) => {
            asked.push(days);
            return agenda(days);
          },
        }),
  });
  return { app, asked, logs };
}

const PAGE = { host: "127.0.0.1:8787", authorization: `Bearer ${TOKEN}` };
const get = (
  app: ReturnType<typeof setup>["app"],
  query = "",
  headers: Record<string, string> = PAGE,
) => app.request(`/api/agenda${query}`, { headers });

describe("GET /api/agenda", () => {
  it("with the token: read for 7 days by default, never cached", async () => {
    const { app, asked } = setup(async () => VIEW);
    const response = await get(app);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(VIEW);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(asked).toEqual([7]);
  });

  it.each([
    ["no token", "", { host: "127.0.0.1:8787" }],
    [
      "another token",
      "",
      { host: "127.0.0.1:8787", authorization: "Bearer autre-jeton-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
    ],
    ["the token in the address only", `?token=${TOKEN}`, { host: "127.0.0.1:8787" }],
    ["another host name", "", { host: "evil.exemple.test", authorization: `Bearer ${TOKEN}` }],
  ])("%s: refused, nothing read", async (_, query, headers) => {
    const { app, asked } = setup(async () => VIEW);
    const response = await get(app, query, headers);
    expect([401, 403, 421]).toContain(response.status);
    expect(asked).toEqual([]);
  });

  it.each([
    "?jours=0",
    "?jours=32",
    "?jours=abc",
    "?jours=7.5",
    "?jours=-1",
    "?jours=007",
    "?jours=",
  ])("%s: refused before any reading", async (query) => {
    const { app, asked } = setup(async () => VIEW);
    expect((await get(app, query)).status).toBe(400);
    expect(asked).toEqual([]);
  });

  it("1 and 31 are read", async () => {
    const { app, asked } = setup(async () => VIEW);
    expect((await get(app, "?jours=1")).status).toBe(200);
    expect((await get(app, "?jours=31")).status).toBe(200);
    expect(asked).toEqual([1, 31]);
  });

  it("not wired: said, not hidden", async () => {
    const { app } = setup();
    expect((await get(app)).status).toBe(503);
  });

  it("a fault inside: a silent 500, the message neither answered nor logged", async () => {
    const { app, logs } = setup(async () => {
      throw new Error("Rendez-vous avec M. Untel");
    });
    const response = await get(app);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("Untel");
    expect(logs.join("\n")).not.toContain("Untel");
  });
});
