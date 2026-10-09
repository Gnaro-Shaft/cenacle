// The CTO's service (ADR-0020), on a real Unix socket with a fake model: only
// I can open it, one question at a time, a bounded line, refusals said and
// never guessed, a model error that leaks nothing, and a client that turns
// every failure into an error — never an empty answer.
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ModelUnavailableError } from "@cenacle/brain";
import { afterEach, describe, expect, it } from "vitest";
import { askCtoService, type CtoServiceError } from "./client.ts";
import type { CtoProgress, CtoReply } from "./pipeline.ts";
import { MAX_LINE } from "./protocol.ts";
import { createCtoService, listenCto } from "./service.ts";

const reply = (text: string): CtoReply => ({
  text,
  summary: "✔ 1 référence vérifiée dans le dépôt",
  cut: false,
  revised: false,
  seconds: 1,
  documents: 40,
});
let closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers) await close();
  closers = [];
});
const socketPath = () => join(mkdtempSync(join(tmpdir(), "cto-")), "s", "cto.sock");

async function start(
  ask: (q: string, p: (x: CtoProgress) => void) => Promise<CtoReply>,
  options: { requestTimeoutMs?: number } = {},
) {
  const path = socketPath();
  const listener = await listenCto(path, createCtoService({ ask }), options);
  closers.push(() => listener.close());
  return path;
}

/** Sends raw bytes, collects every line until the service closes. */
function raw(path: string, payload: string): Promise<string[]> {
  return new Promise((resolve) => {
    let data = "";
    const conn = createConnection(path, () => conn.write(payload));
    conn.setEncoding("utf8");
    conn.on("data", (d: string) => {
      data += d;
    });
    conn.on("error", () => {});
    conn.on("close", () => resolve(data.split("\n").filter((l) => l !== "")));
  });
}

describe("the CTO's socket", () => {
  it("only I can open it (0600 in a 0700 folder), and a question gets progress then its answer", async () => {
    const path = await start(async (q, p) => {
      p({ kind: "reading", phase: "premier jet" });
      return reply(`réponse à : ${q}`);
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
    const seen: CtoProgress[] = [];
    const got = await askCtoService(path, "Où en est M2 ?", { onProgress: (p) => seen.push(p) });
    expect(got.text).toBe("réponse à : Où en est M2 ?");
    expect(seen).toEqual([{ kind: "reading", phase: "premier jet" }]);
  });

  it.each([
    ["an empty question", '{"question":"   "}\n'],
    ["a question too long", `${JSON.stringify({ question: "x".repeat(2001) })}\n`],
    ["a control character", `${JSON.stringify({ question: "a\u0000b" })}\n`],
    ["not a text", '{"question":42}\n'],
    ["an extra field", '{"question":"q","tools":["shell"]}\n'],
    ["malformed JSON", "{question\n"],
    ["a line without end, too long", "x".repeat(MAX_LINE + 10)],
  ])("refuses %s, and never asks the model", async (_, payload) => {
    let asked = 0;
    const path = await start(async () => {
      asked++;
      return reply("non");
    });
    const lines = await raw(path, payload);
    expect(lines.map((l) => JSON.parse(l).code)).toEqual(["invalid"]);
    expect(asked).toBe(0);
  });

  it("one question at a time: three wait in line, the fifth is told busy", async () => {
    let running = 0;
    let most = 0;
    const releases: Array<() => void> = [];
    const path = await start(async (q) => {
      running++;
      most = Math.max(most, running);
      await new Promise<void>((r) => releases.push(r));
      running--;
      return reply(q);
    });
    const asks = ["q1", "q2", "q3", "q4"].map((q) => askCtoService(path, q));
    await new Promise((r) => setTimeout(r, 100));
    await expect(askCtoService(path, "q5")).rejects.toMatchObject({ code: "busy" });
    for (let i = 0; i < 4; i++) {
      while (releases.length === 0) await new Promise((r) => setTimeout(r, 10));
      releases.shift()?.();
    }
    expect((await Promise.all(asks)).map((r) => r.text)).toEqual(["q1", "q2", "q3", "q4"]);
    expect(most).toBe(1);
  });

  it("a caller gone while waiting: the model is not asked for nobody", async () => {
    const asked: string[] = [];
    let release = () => {};
    const path = await start(async (q) => {
      asked.push(q);
      if (q === "first") {
        await new Promise<void>((r) => {
          release = r;
        });
      }
      return reply(q);
    });
    const first = askCtoService(path, "first");
    await new Promise((r) => setTimeout(r, 50));
    const conn = createConnection(path, () => conn.write('{"question":"gone"}\n'));
    conn.on("error", () => {});
    await new Promise((r) => setTimeout(r, 50));
    conn.destroy();
    await new Promise((r) => setTimeout(r, 50));
    release();
    await first;
    await new Promise((r) => setTimeout(r, 50));
    expect(asked).toEqual(["first"]);
  });

  it("a model error: a code and a generic word, never the server's message", async () => {
    const down = await start(async () => {
      throw new ModelUnavailableError("connect ECONNREFUSED 100.64.0.1:1234");
    });
    await expect(askCtoService(down, "q")).rejects.toMatchObject({ code: "model_unavailable" });
    const boom = await start(async () => {
      throw new Error("leak: claire@client.example");
    });
    const error = await askCtoService(boom, "q").catch((e: CtoServiceError) => e);
    expect(error).toMatchObject({ code: "internal" });
    expect((error as Error).message).not.toMatch(/claire|leak/);
  });

  it("a caller that sends nothing is dropped", async () => {
    const path = await start(async () => reply("x"), { requestTimeoutMs: 100 });
    const started = Date.now();
    const lines = await raw(path, "");
    expect(lines).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("replaces a stale socket, and refuses to delete anything else", async () => {
    const path = await start(async () => reply("x"));
    await closers.pop()?.();
    const stale = createServer();
    await new Promise<void>((r) => stale.listen(path, () => r()));
    // Closing a listener removes its file: put a stale one back by hand.
    await new Promise<void>((r) => stale.close(() => r()));
    const leftover = createServer();
    await new Promise<void>((r) => leftover.listen(path, () => r()));
    leftover.unref();
    const again = await listenCto(path, createCtoService({ ask: async () => reply("ok") }));
    closers.push(() => again.close());
    expect((await askCtoService(path, "q")).text).toBe("ok");
    const file = join(dirname(path), "not-a-socket");
    writeFileSync(file, "garde-moi");
    await expect(
      listenCto(file, createCtoService({ ask: async () => reply("x") })),
    ).rejects.toThrow(/not a socket/);
    expect(statSync(file).isFile()).toBe(true);
  });
});

describe("the client", () => {
  it("no service: unreachable — the caller may answer on its own", async () => {
    await expect(askCtoService(socketPath(), "q")).rejects.toMatchObject({ code: "unreachable" });
  });

  it.each([
    ["a malformed line", "not json\n"],
    ["an answer missing its fields", '{"event":"answer","reply":{"text":"x"}}\n'],
    ["an unknown error code", '{"event":"error","code":"rm -rf","message":"x"}\n'],
    ["a close without answer", ""],
  ])("%s from the service: an error, never an empty answer", async (_, line) => {
    const path = socketPath();
    mkdirSync(dirname(path), { recursive: true });
    const sockets: Array<{ destroy(): void }> = [];
    const fake = createServer((c) => {
      sockets.push(c);
      c.end(line);
    });
    await new Promise<void>((r) => fake.listen(path, () => r()));
    closers.push(
      () =>
        new Promise((r) => {
          fake.close(() => r());
          for (const s of sockets) s.destroy();
        }),
    );
    await expect(askCtoService(path, "q")).rejects.toMatchObject({ code: "broken" });
  });

  it("a service that never answers: a timeout", async () => {
    const path = await start(() => new Promise<CtoReply>(() => {}));
    await expect(askCtoService(path, "q", { timeoutMs: 200 })).rejects.toMatchObject({
      code: "timeout",
    });
  });
});
