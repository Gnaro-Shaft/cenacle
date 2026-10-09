// One Iris at a time (ADR-0018): a second instance is refused, the lock falls
// when the holder exits or is killed, programs do not block each other, and a
// bad program name or an unreachable database never yields a lock.
import { spawn } from "node:child_process";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { holdSingleInstance, type InstanceLock, instanceLockKey } from "./instance-lock.ts";
import { appUrlFromEnv } from "./migrate.ts";
import { appConnection, TEST_DB } from "./test-db.ts";

const a = appConnection();
const b = appConnection();
// Bounded: a broken lock may leave connections reserved — fail, never hang.
afterAll(async () => {
  await a.end({ timeout: 5 });
  await b.end({ timeout: 5 });
});

async function eventually(take: () => Promise<InstanceLock | null>, ms = 10_000) {
  const until = Date.now() + ms;
  for (;;) {
    const got = await take();
    if (got !== null || Date.now() > until) return got;
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("holdSingleInstance", () => {
  it("a second instance is refused while the first holds the lock, then admitted", async () => {
    const first = await holdSingleInstance(a, "iris-t1");
    expect(first).not.toBeNull();
    expect(await holdSingleInstance(b, "iris-t1")).toBeNull();
    await first?.release();
    const second = await holdSingleInstance(b, "iris-t1");
    expect(second).not.toBeNull();
    await second?.release();
  });

  it("refused twice even from the same pool: a lock is per connection, never re-entrant", async () => {
    const first = await holdSingleInstance(a, "iris-t2");
    expect(await holdSingleInstance(a, "iris-t2")).toBeNull();
    await first?.release();
  });

  it("programs do not block each other", async () => {
    const iris = await holdSingleInstance(a, "iris-t3");
    const server = await holdSingleInstance(b, "server-t3");
    expect(iris).not.toBeNull();
    expect(server).not.toBeNull();
    await iris?.release();
    await server?.release();
  });

  it("release twice is harmless, and the pool stays usable", async () => {
    const lock = await holdSingleInstance(a, "iris-t4");
    await lock?.release();
    await lock?.release();
    expect((await a`select 1 as one`)[0]?.one).toBe(1);
  });

  it("a holder killed with SIGKILL: the lock falls by itself", async () => {
    const script = join(import.meta.dirname, "instance-lock.child.ts");
    const child = spawn(process.execPath, [script, "iris-t5"], {
      env: { ...process.env, LOCK_URL: appUrlFromEnv(TEST_DB) },
      stdio: ["ignore", "pipe", "inherit"],
    });
    await new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (d) => {
        if (String(d).includes("locked")) resolve();
      });
      child.on("exit", (code) => reject(new Error(`child exited early (${code})`)));
    });
    expect(await holdSingleInstance(b, "iris-t5")).toBeNull();
    child.kill("SIGKILL");
    const after = await eventually(() => holdSingleInstance(b, "iris-t5"));
    expect(after).not.toBeNull();
    await after?.release();
  });

  it.each(["", "Iris", "../iris", "iris lock", "a".repeat(33)])(
    "refuses the program name %j",
    (name) => {
      expect(() => instanceLockKey(name)).toThrow(/invalid program name/);
    },
  );

  it("keys are stable, distinct per program, and positive 63-bit", () => {
    expect(instanceLockKey("iris")).toBe(instanceLockKey("iris"));
    expect(instanceLockKey("iris")).not.toBe(instanceLockKey("server"));
    expect(instanceLockKey("iris") > 0n).toBe(true);
    expect(instanceLockKey("iris") <= 0x7fff_ffff_ffff_ffffn).toBe(true);
  });

  it("an unreachable database throws: no lock, no start", async () => {
    const dead = postgres("postgres://nobody:x@127.0.0.1:1/none", {
      connect_timeout: 2,
      onnotice: () => {},
    });
    await expect(holdSingleInstance(dead, "iris-t6")).rejects.toThrow();
    await dead.end({ timeout: 1 });
  });
});
