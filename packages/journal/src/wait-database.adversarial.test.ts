// A program started before its database waits for it (lot C, 13/11): one
// line said once, retries spaced 2 s to 30 s, 5 minutes at most; a refusal
// that waiting cannot cure quits at once. Then a real client, through a
// door that opens late — as Postgres does at the Mac's start.
import { createServer, connect as tcp } from "node:net";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { appUrlFromEnv } from "./migrate.ts";
import { loadEnv, TEST_DB } from "./test-db.ts";
import { DatabaseWaitError, notYet, untilDatabaseAnswers, WAIT_MAX_MS } from "./wait-database.ts";

const ADDRESS = "someone@example.test";
const failure = (code: string) =>
  Object.assign(new Error(`connect ${ADDRESS} 10.0.0.1:5432`), { code });

function fake(failures: readonly (Error | null)[], maxMs?: number) {
  let t = 0;
  const lines: string[] = [];
  const sleeps: number[] = [];
  let calls = 0;
  const query = async () => {
    const f = failures[calls++] ?? null;
    if (f !== null) throw f;
  };
  const deps = {
    log: (line: string) => lines.push(line),
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    now: () => t,
    ...(maxMs === undefined ? {} : { maxMs }),
  };
  return { query, deps, lines, sleeps, calls: () => calls };
}

describe("waiting for the base", () => {
  it("an answer at once: no line, no wait", async () => {
    const f = fake([]);
    await untilDatabaseAnswers(f.query, f.deps);
    expect(f.lines).toEqual([]);
    expect(f.sleeps).toEqual([]);
  });

  it("refused three times, then it answers: one line to wait, one to start, 2-4-8 s", async () => {
    const f = fake([failure("ECONNREFUSED"), failure("57P03"), failure("ECONNREFUSED")]);
    await untilDatabaseAnswers(f.query, f.deps);
    expect(f.sleeps).toEqual([2000, 4000, 8000]);
    // The code shows once errorText gives it (lot C1); the message, never.
    expect(f.lines).toHaveLength(2);
    expect(f.lines[0]).toMatch(
      /^⏳ La base ne répond pas encore \(Error(?: \(ECONNREFUSED\))?\) : j'attends, 5 min au plus\.$/,
    );
    expect(f.lines[1]).toBe("✔ La base répond : le programme démarre.");
  });

  it("the spacing stops growing at 30 s", async () => {
    const f = fake(Array.from({ length: 8 }, () => failure("ECONNREFUSED")));
    await untilDatabaseAnswers(f.query, f.deps);
    expect(f.sleeps).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000]);
  });

  it("gives up after 5 minutes, in one line that quotes nothing", async () => {
    const f = fake(Array.from({ length: 100 }, () => failure("ECONNREFUSED")));
    const error = await untilDatabaseAnswers(f.query, f.deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DatabaseWaitError);
    expect((error as Error).message).toMatch(
      /^the database did not answer in 5 min \(Error(?: \(ECONNREFUSED\))?\)$/,
    );
    // Exactly the bound: the last wait is cut to what is left.
    expect(f.sleeps.reduce((a, b) => a + b, 0)).toBe(WAIT_MAX_MS);
    expect(JSON.stringify(f.lines)).not.toContain("example.test");
  });

  it.each([
    ["a wrong password", "28P01"],
    ["an unknown database", "3D000"],
    ["a missing privilege", "42501"],
    ["no code at all", ""],
  ])("%s is not waited for: thrown at once", async (_label, code) => {
    const f = fake([failure(code)]);
    await expect(untilDatabaseAnswers(f.query, f.deps)).rejects.toThrow();
    expect(f.sleeps).toEqual([]);
    expect(f.calls()).toBe(1);
  });

  it("only the absence of the base is worth waiting for", () => {
    expect(notYet(failure("ECONNREFUSED"))).toBe(true);
    expect(notYet(failure("CONNECTION_ENDED"))).toBe(true);
    expect(notYet(failure("ENOTFOUND"))).toBe(true);
    expect(notYet(failure("28P01"))).toBe(false);
    expect(notYet({ code: "ECONNREFUSED" })).toBe(false);
    expect(notYet("ECONNREFUSED")).toBe(false);
  });
});

describe("a real client, the base's door opening late", () => {
  it("waits through the refusals, then reads from the test database", async () => {
    loadEnv();
    const target = new URL(appUrlFromEnv(TEST_DB));
    // A door to the base that opens 2.5 s after the program starts.
    const door = createServer((socket) => {
      const upstream = tcp(Number(target.port), target.hostname);
      socket.pipe(upstream).pipe(socket);
      socket.on("error", () => upstream.destroy());
      upstream.on("error", () => socket.destroy());
    });
    const port = await new Promise<number>((resolve) => {
      const probe = createServer().listen(0, "127.0.0.1", () => {
        const address = probe.address();
        probe.close(() => resolve(typeof address === "object" && address ? address.port : 0));
      });
    });
    const url = new URL(target);
    url.port = String(port);
    const sql = postgres(url.toString(), { infer: true, max: 1, onnotice: () => {} });
    const lines: string[] = [];
    const opening = setTimeout(() => door.listen(port, "127.0.0.1"), 2500);
    try {
      const started = Date.now();
      await untilDatabaseAnswers(() => sql`select 1`, {
        log: (line) => lines.push(line),
        sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 1000))),
        now: () => Date.now(),
      });
      expect(Date.now() - started).toBeGreaterThanOrEqual(2000);
      expect(lines[0]).toMatch(/^⏳ La base ne répond pas encore \(/);
      expect(lines[0]).not.toMatch(/127\.0\.0\.1|:\d{4,5}/);
      expect(lines.at(-1)).toBe("✔ La base répond : le programme démarre.");
      expect((await sql`select current_database() as db`)[0]?.db).toBe(TEST_DB);
    } finally {
      clearTimeout(opening);
      await sql.end({ timeout: 1 });
      door.close();
    }
  });
});
