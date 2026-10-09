// Asking the CTO from the page (ADR-0020): only the page, with the token of
// this run of the server; a malformed question never reaches the CTO; his
// refusals come back as a status and a short reason; an internal error leaks
// nothing.
import { type CtoReply, CtoServiceError } from "@cenacle/cto";
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
const answer: CtoReply = {
  text: "<script>alert(1)</script> Voir ADR-0017.",
  summary: "✔ 1 référence vérifiée dans le dépôt",
  cut: false,
  revised: false,
  seconds: 12,
  documents: 40,
};

function setup(askCto?: (q: string) => Promise<CtoReply>) {
  const asked: string[] = [];
  const app = createApp({
    readAfter: async () => [],
    guard: defaultGuardConfig(TOKEN),
    proposals,
    ...(askCto === undefined
      ? {}
      : {
          askCto: async (q: string) => {
            asked.push(q);
            return askCto(q);
          },
        }),
  });
  return { app, asked };
}

const PAGE: Record<string, string> = {
  host: "127.0.0.1:5173",
  origin: "http://127.0.0.1:5173",
  authorization: `Bearer ${TOKEN}`,
  "content-type": "application/json",
};
const post = (app: ReturnType<typeof setup>["app"], body: string, headers = PAGE) =>
  app.request("/api/cto", { method: "POST", headers, body });

describe("POST /api/cto", () => {
  it("the page with its token: the question goes to the CTO, his answer comes back as is", async () => {
    const { app, asked } = setup(async () => answer);
    const response = await post(app, JSON.stringify({ question: "  Où en est M2 ?  " }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ reply: answer });
    expect(asked).toEqual(["Où en est M2 ?"]);
  });

  it.each([
    ["no token", { ...PAGE, authorization: "" }, 401],
    ["a wrong token", { ...PAGE, authorization: "Bearer nope" }, 401],
    ["another origin", { ...PAGE, origin: "https://evil.example" }, 403],
    ["not JSON", { ...PAGE, "content-type": "text/plain" }, 415],
    ["another host (DNS rebinding)", { ...PAGE, host: "evil.example:5173" }, 421],
  ])("refused with %s, before the CTO", async (_, headers, status) => {
    const { app, asked } = setup(async () => answer);
    const response = await post(app, JSON.stringify({ question: "q" }), headers);
    expect(response.status).toBe(status);
    expect(asked).toEqual([]);
  });

  it("refused without origin, before the CTO", async () => {
    const { app, asked } = setup(async () => answer);
    const { origin: _, ...noOrigin } = PAGE;
    expect((await post(app, JSON.stringify({ question: "q" }), noOrigin)).status).toBe(403);
    expect(asked).toEqual([]);
  });

  it.each([
    ["an empty question", JSON.stringify({ question: " " })],
    ["a question too long", JSON.stringify({ question: "x".repeat(2001) })],
    ["not a text", JSON.stringify({ question: ["q"] })],
    ["malformed JSON", "{question"],
    ["an array", "[]"],
  ])("%s: 400, and the CTO is never asked", async (_, body) => {
    const { app, asked } = setup(async () => answer);
    expect((await post(app, body)).status).toBe(400);
    expect(asked).toEqual([]);
  });

  it("a body too large: 413", async () => {
    const { app, asked } = setup(async () => answer);
    expect((await post(app, JSON.stringify({ question: "x".repeat(20_000) }))).status).toBe(413);
    expect(asked).toEqual([]);
  });

  it("the CTO not plugged in: 503, said", async () => {
    const { app } = setup();
    expect((await post(app, JSON.stringify({ question: "q" }))).status).toBe(503);
  });

  it.each([
    ["busy", 503],
    ["unreachable", 503],
    ["model_unavailable", 503],
    ["timeout", 504],
    ["broken", 502],
  ] as const)("the CTO %s: %i, with his short reason", async (code, status) => {
    const { app } = setup(async () => {
      throw new CtoServiceError(code, `raison ${code}`);
    });
    const response = await post(app, JSON.stringify({ question: "q" }));
    expect(response.status).toBe(status);
    expect(await response.json()).toHaveProperty("error");
  });

  it("an unexpected error: 502 and a generic word, nothing of its message", async () => {
    const { app } = setup(async () => {
      throw new Error("connect ECONNREFUSED claire@client.example");
    });
    const response = await post(app, JSON.stringify({ question: "q" }));
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toMatch(/claire|ECONNREFUSED/);
  });
});
