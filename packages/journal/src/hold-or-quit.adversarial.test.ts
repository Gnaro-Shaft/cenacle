// holdOrQuit (lot E4, 13/11): the single-instance block six programs share.
// Another holds the lock: one line, both connections closed, exit 75 — never
// a second instance. Run in real processes against the test database.
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appUrlFromEnv } from "./migrate.ts";
import { loadEnv, TEST_DB } from "./test-db.ts";

loadEnv();
const URL_ = appUrlFromEnv(TEST_DB);
const lockModule = join(import.meta.dirname, "instance-lock.ts");
const holdThenWait = (program: string) => `
import postgres from "postgres";
const { holdOrQuit } = await import(${JSON.stringify(lockModule)});
const opts = { infer: true, max: 1, max_lifetime: null, idle_timeout: 0, onnotice: () => {} };
const lockSql = postgres(process.env.LOCK_URL, opts);
const sql = postgres(process.env.LOCK_URL, { ...opts, max: 2 });
await holdOrQuit(lockSql, sql, ${JSON.stringify(program)}, "Un autre tourne déjà : celui-ci ne démarre pas.");
process.stdout.write("locked\\n");
setInterval(() => {}, 60_000);
`;

describe("holdOrQuit", () => {
  it("a second instance says it in one line, exits 75, and the first keeps the lock", async () => {
    const program = `hold-${process.pid}`;
    const first = spawn(process.execPath, ["--input-type=module", "-e", holdThenWait(program)], {
      env: { ...process.env, LOCK_URL: URL_ },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        first.stdout.on("data", (d) => String(d).includes("locked") && resolve());
        first.on("exit", (code) => reject(new Error(`first exited early (${code})`)));
      });
      const second = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", holdThenWait(program)],
        {
          env: { ...process.env, LOCK_URL: URL_ },
          encoding: "utf8",
          timeout: 20_000,
        },
      );
      expect(second.status).toBe(75);
      expect(second.stdout).toBe("");
      expect(second.stderr).toBe("🛑 Un autre tourne déjà : celui-ci ne démarre pas.\n");
      expect(first.exitCode).toBeNull();
    } finally {
      first.kill("SIGKILL");
    }
  });
});
