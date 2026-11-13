// A 500 or a broken stream leaves one line in the log (lot C, 13/11): the
// route's pattern and the error's name and code — never a value of the
// request, never the error's message, never a stack.
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { defaultGuardConfig, newToken } from "./guard.ts";
import type { ProposalsService } from "./proposals-service.ts";
import type { ProspectionService } from "./prospection-service.ts";

const TOKEN = newToken();
const ADDRESS = "claire@client.example";
const leak = () =>
  Object.assign(new Error(`connect ${ADDRESS} at /Users/x`), { code: "ECONNREFUSED" });
const PAGE = {
  host: "127.0.0.1:5173",
  origin: "http://127.0.0.1:5173",
  authorization: `Bearer ${TOKEN}`,
  "content-type": "application/json",
};

function setup(over: Partial<Parameters<typeof createApp>[0]> = {}) {
  const lines: string[] = [];
  const boom = async () => {
    throw leak();
  };
  const proposals: ProposalsService = {
    list: boom,
    edit: boom,
    accept: boom,
    refuse: boom,
    cancel: boom,
  };
  const app = createApp({
    readAfter: async () => [],
    guard: defaultGuardConfig(TOKEN),
    proposals,
    log: (line) => lines.push(line),
    ...over,
  });
  return { app, lines };
}

const clean = (lines: string[]) => {
  for (const line of lines) {
    expect(line).not.toContain(ADDRESS);
    expect(line).not.toContain("/Users/");
    expect(line).not.toContain("\n");
  }
};

describe("a 500 is said in one line", () => {
  it("an action: the method, the route's pattern (not the id), the error's name and code", async () => {
    const { app, lines } = setup();
    const r = await app.request("/api/proposals/p-hidden-42/accept", {
      method: "POST",
      headers: PAGE,
      body: "{}",
    });
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "internal error" });
    expect(lines).toEqual(["⚠ API POST /api/proposals/:id/accept : Error (ECONNREFUSED)"]);
    clean(lines);
  });

  it("a route that does not catch (the list): the same line, by the app's last resort", async () => {
    const { app, lines } = setup();
    const r = await app.request("/api/proposals", { headers: PAGE });
    expect(r.status).toBe(500);
    expect(lines).toEqual(["⚠ API GET /api/proposals : Error (ECONNREFUSED)"]);
  });

  it("the board's routes too", async () => {
    const boom = async () => {
      throw leak();
    };
    const prospection = {
      list: boom,
      toRead: boom,
      add: boom,
      move: boom,
    } as unknown as ProspectionService;
    const { app, lines } = setup({ prospection });
    const r = await app.request("/api/prospection/cartes/7/deplacer", {
      method: "POST",
      headers: PAGE,
      body: JSON.stringify({ colonne: "won" }),
    });
    expect(r.status).toBe(500);
    expect(lines).toEqual([
      "⚠ API POST /api/prospection/cartes/:id/deplacer : Error (ECONNREFUSED)",
    ]);
  });

  it("a refusal the code wrote (409) and a refused caller (401) leave nothing", async () => {
    const { app, lines } = setup();
    await app.request("/api/proposals", { headers: { host: "127.0.0.1:5173" } });
    expect(lines).toEqual([]);
  });
});

describe("a broken stream is said in one line", () => {
  it("the database gone while the page follows the team", async () => {
    const { app, lines } = setup({
      readAfter: async () => {
        throw leak();
      },
    });
    const r = await app.request("/api/agents/stream?agents=iris", {
      headers: { host: "127.0.0.1:5173" },
    });
    await r.text();
    expect(lines).toEqual(["⚠ API flux /api/agents/stream interrompu : Error (ECONNREFUSED)"]);
    clean(lines);
  });
});

describe("the last resort keeps an answer thrown on purpose", () => {
  it("an HTTPException keeps its status and leaves no line", async () => {
    const { app, lines } = setup();
    app.get("/api/thrown", () => {
      throw new HTTPException(418, { message: "teapot" });
    });
    const r = await app.request("/api/thrown", { headers: { host: "127.0.0.1:5173" } });
    expect(r.status).toBe(418);
    expect(lines).toEqual([]);
  });
});
