// The buttons that act: only the page, with the token of this run of the
// server, from this machine. Everything else is refused before the service.
import { ProposalError } from "@cenacle/journal";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { defaultGuardConfig } from "./guard.ts";
import type { ProposalsService } from "./proposals-service.ts";

const TOKEN = "s3cr3t-token-of-this-run-xxxxxxxxxxxxxxxxxx";

function setup() {
  const calls: string[] = [];
  const service: ProposalsService = {
    list: async () => [],
    edit: async (id, draft) => {
      calls.push(`edit ${id} ${String(draft)}`);
    },
    accept: async (id) => {
      calls.push(`accept ${id}`);
      if (id === "p-done")
        throw new ProposalError(`proposal ${id} cannot be accepted: it is refused`);
      if (id === "p-boom") throw new Error("connect ECONNREFUSED claire@client.example");
    },
    refuse: async (id) => {
      calls.push(`refuse ${id}`);
    },
    cancel: async (id) => {
      calls.push(`cancel ${id}`);
    },
  };
  const app = createApp({
    readAfter: async () => [],
    guard: defaultGuardConfig(TOKEN),
    proposals: service,
  });
  return { app, calls };
}

const PAGE = {
  host: "127.0.0.1:5173",
  origin: "http://127.0.0.1:5173",
  authorization: `Bearer ${TOKEN}`,
  "content-type": "application/json",
};
const post = (headers: Record<string, string> = PAGE, body = "{}") => ({
  method: "POST",
  headers,
  body,
});
const without = (key: keyof typeof PAGE) =>
  Object.fromEntries(Object.entries(PAGE).filter(([k]) => k !== key));

describe("proposals API — who may act", () => {
  it("the page with the token can accept", async () => {
    const { app, calls } = setup();
    const r = await app.request("/api/proposals/p-1/accept", post());
    expect(r.status).toBe(200);
    expect(calls).toEqual(["accept p-1"]);
  });

  it.each([
    ["no token", without("authorization"), 401],
    ["a wrong token", { ...PAGE, authorization: "Bearer guess" }, 401],
    [
      "a token of the same length",
      { ...PAGE, authorization: `Bearer ${"x".repeat(TOKEN.length)}` },
      401,
    ],
    ["another site's page", { ...PAGE, origin: "https://evil.example" }, 403],
    ["no origin", without("origin"), 403],
    [
      "a form post (not JSON)",
      { ...PAGE, "content-type": "application/x-www-form-urlencoded" },
      415,
    ],
    ["a domain pointed at this machine", { ...PAGE, host: "evil.example:5173" }, 421],
  ])("refuses %s, before reaching the service", async (_label, headers, status) => {
    const { app, calls } = setup();
    const r = await app.request(
      "/api/proposals/p-1/accept",
      post(headers as Record<string, string>),
    );
    expect(r.status).toBe(status);
    expect(calls).toEqual([]);
  });

  it("reading the drafts needs the token too (they are mail content)", async () => {
    const { app } = setup();
    const r = await app.request("/api/proposals", { headers: { host: "127.0.0.1:5173" } });
    expect(r.status).toBe(401);
    const ok = await app.request("/api/proposals", {
      headers: { host: "127.0.0.1:5173", authorization: `Bearer ${TOKEN}` },
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
  });

  it("the status stream stays open without token, but only from this machine", async () => {
    const { app } = setup();
    const r = await app.request("/api/health", { headers: { host: "rebound.example:8787" } });
    expect(r.status).toBe(421);
  });
});

describe("proposals API — what may be asked", () => {
  it.each(["p-1;drop", "..%2f..", "a".repeat(65)])("refuses the id %s", async (id) => {
    const { app, calls } = setup();
    const r = await app.request(`/api/proposals/${id}/accept`, post());
    expect(r.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("refuses broken or oversized bodies", async () => {
    const { app, calls } = setup();
    expect((await app.request("/api/proposals/p-1/refuse", post(PAGE, "{oops"))).status).toBe(400);
    expect((await app.request("/api/proposals/p-1/refuse", post(PAGE, "[1]"))).status).toBe(400);
    expect(
      (await app.request("/api/proposals/p-1/refuse", post(PAGE, `"${"x".repeat(20000)}"`))).status,
    ).toBe(413);
    expect(calls).toEqual([]);
  });

  it("a refused transition says why (409); any other error says nothing (500)", async () => {
    const { app } = setup();
    const done = await app.request("/api/proposals/p-done/accept", post());
    expect(done.status).toBe(409);
    expect(await done.json()).toEqual({
      error: "proposal p-done cannot be accepted: it is refused",
    });
    const boom = await app.request("/api/proposals/p-boom/accept", post());
    expect(boom.status).toBe(500);
    expect(await boom.text()).not.toContain("claire");
  });

  it("an edit goes through PUT with the text", async () => {
    const { app, calls } = setup();
    const r = await app.request("/api/proposals/p-1/draft", {
      method: "PUT",
      headers: PAGE,
      body: JSON.stringify({ draft: "Bonjour" }),
    });
    expect(r.status).toBe(200);
    expect(calls).toEqual(["edit p-1 Bonjour"]);
  });
});
