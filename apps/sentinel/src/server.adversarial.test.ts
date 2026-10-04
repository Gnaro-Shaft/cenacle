// S2: the sentinel's door opens to the token holder only, with a small JSON
// heartbeat and nothing else.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHandler } from "./server.ts";
import { createWatch } from "./watch.ts";

const TOKEN = "t".repeat(40);
const NOW = new Date("2026-10-05T10:00:00.000Z");
const watch = createWatch({ silenceMs: 10 * 60_000, startedAt: NOW });
let server: Server;
let url = "";
beforeAll(async () => {
  server = createServer(createHandler({ token: TOKEN, watch, now: () => NOW }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const beat = JSON.stringify({ program: "iris", at: NOW.toISOString() });
const post = (body: string, headers: Record<string, string> = {}, path = "/battement") =>
  fetch(`${url}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...headers },
    body,
  }).then((r) => r.status);

describe("the sentinel's door", () => {
  it("takes a valid heartbeat from the token holder", async () => {
    expect(await post(beat)).toBe(204);
  });

  it.each([
    ["a wrong token", { authorization: `Bearer ${"x".repeat(40)}` }, 401],
    ["no token", { authorization: "" }, 401],
    ["a form", { "content-type": "text/plain" }, 415],
  ])("refuses %s", async (_label, headers, status) => {
    expect(await post(beat, headers)).toBe(status);
  });

  it("refuses another route, another method, a body too large, broken JSON, a field more", async () => {
    expect(await post(beat, {}, "/etat")).toBe(404);
    expect((await fetch(`${url}/battement`)).status).toBe(404);
    expect(await post("x".repeat(2000))).toBe(413);
    expect(await post("{not json")).toBe(400);
    expect(
      await post(JSON.stringify({ program: "iris", at: NOW.toISOString(), text: "Bonjour" })),
    ).toBe(400);
  });
});
