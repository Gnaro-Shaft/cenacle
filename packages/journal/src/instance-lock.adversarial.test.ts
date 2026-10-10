// One Iris at a time (ADR-0018): a second instance is refused, the lock falls
// when the holder exits or is killed, programs do not block each other, and a
// bad program name or an unreachable database never yields a lock. And
// (ADR-0023) a lock dropped by a cut of the database is noticed and taken
// again — or given up when another instance took it meanwhile.
import { spawn } from "node:child_process";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { connectLockAsApp } from "./connect.ts";
import {
  holdSingleInstance,
  type InstanceLock,
  instanceLockKey,
  type LockCheck,
} from "./instance-lock.ts";
import { appUrlFromEnv } from "./migrate.ts";
import { appConnection, loadEnv, TEST_DB } from "./test-db.ts";

loadEnv();
// Two programs' lock clients (one connection each), and an ordinary pool to
// cut their sessions as a restart of the database would.
const a = connectLockAsApp(TEST_DB);
const b = connectLockAsApp(TEST_DB);
const admin = appConnection();
// Bounded: a broken lock must fail, never hang.
afterAll(async () => {
  await Promise.all([a, b, admin].map((c) => c.end({ timeout: 5 })));
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

  it("refused twice even from the same client: never re-entrant", async () => {
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
      max: 1,
      max_lifetime: null,
      connect_timeout: 2,
      onnotice: () => {},
    });
    await expect(holdSingleInstance(dead, "iris-t6")).rejects.toThrow();
    await dead.end({ timeout: 1 });
  });

  it("a pool of several connections is refused: it would check on one and lock on another", async () => {
    const pool = appConnection();
    await expect(holdSingleInstance(pool, "iris-t7")).rejects.toThrow(/client of its own/);
    await pool.end({ timeout: 2 });
  });
});

/** Cuts the session holding a program's lock, as a restart of the database would. */
async function cut(program: string) {
  const key = instanceLockKey(program).toString();
  const rows = await admin<{ pid: number }[]>`
    select pid from pg_locks
    where locktype = 'advisory' and granted
      and ((classid::bigint << 32) | objid::bigint) = ${key}::bigint`;
  expect(rows).toHaveLength(1);
  await admin`select pg_terminate_backend(${rows[0]?.pid ?? 0})`;
}

/** Checks until the answer is no longer "unknown" (the dead connection is replaced first). */
async function settled(lock: InstanceLock, ms = 10_000): Promise<LockCheck> {
  const until = Date.now() + ms;
  for (;;) {
    const state = await lock.check();
    if (state !== "unknown" || Date.now() > until) return state;
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("a lock dropped by a cut of the database (ADR-0023)", () => {
  it("still held: 'held', and checking never stacks it (one release frees it)", async () => {
    const lock = await holdSingleInstance(a, "iris-c1");
    expect(await lock?.check()).toBe("held");
    expect(await lock?.check()).toBe("held");
    await lock?.release();
    const next = await holdSingleInstance(b, "iris-c1");
    expect(next).not.toBeNull();
    await next?.release();
  });

  it("cut, and free: taken again — a second instance is refused once more", async () => {
    const lock = await holdSingleInstance(a, "iris-c2");
    await cut("iris-c2");
    expect(await settled(lock as InstanceLock)).toBe("retaken");
    expect(await holdSingleInstance(b, "iris-c2")).toBeNull();
    expect(await lock?.check()).toBe("held");
    await lock?.release();
  });

  it("cut, and another instance took it meanwhile: 'lost', and the other keeps it", async () => {
    const lock = await holdSingleInstance(a, "iris-c3");
    await cut("iris-c3");
    const other = await eventually(() => holdSingleInstance(b, "iris-c3"));
    expect(other).not.toBeNull();
    expect(await settled(lock as InstanceLock)).toBe("lost");
    expect(await holdSingleInstance(a, "iris-c3")).toBeNull();
    await other?.release();
    await lock?.release();
  });

  it("checked well after the cut (the postgres 3.4.9 trap): an answer, never a hang", async () => {
    const lock = (await holdSingleInstance(a, "iris-c7")) as InstanceLock;
    const uncaught: unknown[] = [];
    const listener = (e: unknown) => uncaught.push(e);
    process.on("uncaughtException", listener);
    try {
      await cut("iris-c7");
      await new Promise((r) => setTimeout(r, 500));
      const first = await Promise.race([
        lock.check(),
        new Promise((r) => setTimeout(() => r("hang"), 5000)),
      ]);
      expect(["retaken", "unknown"]).toContain(first);
      expect(await settled(lock)).toMatch(/held|retaken/);
      expect(uncaught).toEqual([]);
    } finally {
      process.off("uncaughtException", listener);
      await lock.release();
    }
  });

  it("released: never taken again by a check", async () => {
    const lock = await holdSingleInstance(a, "iris-c4");
    await lock?.release();
    expect(await lock?.check()).toBe("unknown");
    const next = await holdSingleInstance(b, "iris-c4");
    expect(next).not.toBeNull();
    await next?.release();
  });

  it("watch: says 'retaken' once after a cut, and stops with release", async () => {
    const lock = (await holdSingleInstance(a, "iris-c5")) as InstanceLock;
    const seen: string[] = [];
    lock.watch({ retaken: () => seen.push("retaken"), lost: () => seen.push("lost") }, 50);
    await new Promise((r) => setTimeout(r, 200));
    expect(seen).toEqual([]);
    await cut("iris-c5");
    const until = Date.now() + 10_000;
    while (seen.length === 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 200));
    expect(seen).toEqual(["retaken"]);
    await lock.release();
    await cut2free("iris-c5");
    await new Promise((r) => setTimeout(r, 200));
    expect(seen).toEqual(["retaken"]);
  });

  it("watch: says 'lost' when another instance took it during the cut", async () => {
    const lock = (await holdSingleInstance(a, "iris-c6")) as InstanceLock;
    const seen: string[] = [];
    await cut("iris-c6");
    const other = await eventually(() => holdSingleInstance(b, "iris-c6"));
    lock.watch({ retaken: () => seen.push("retaken"), lost: () => seen.push("lost") }, 50);
    const until = Date.now() + 10_000;
    while (seen.length === 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    expect(seen[0]).toBe("lost");
    await lock.release();
    await other?.release();
  });
});

/** After release, nobody holds the lock: anyone may take and give it back. */
async function cut2free(program: string) {
  const probe = await holdSingleInstance(b, program);
  expect(probe).not.toBeNull();
  await probe?.release();
}

describe("the database away during a check (ADR-0023)", () => {
  /** A pool that answers like PostgreSQL while `up`, and refuses to connect otherwise. */
  function flakyPool() {
    const state = { up: true, holding: false };
    const client = Object.assign(
      async () => {
        if (!state.up) throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
        const held = state.holding;
        state.holding = true;
        return [{ held, locked: !held }];
      },
      { options: { max: 1, max_lifetime: null } },
    );
    return { state, pool: client as unknown as Parameters<typeof holdSingleInstance>[0] };
  }

  it("'unknown' while away — no exit, no retake — then 'held' again on return", async () => {
    const { state, pool } = flakyPool();
    const lock = (await holdSingleInstance(pool, "iris-d1")) as InstanceLock;
    state.up = false;
    expect(await lock.check()).toBe("unknown");
    expect(await lock.check()).toBe("unknown");
    state.up = true;
    expect(await lock.check()).toBe("held");
    await lock.release();
  });

  it("watch says nothing while the database is away", async () => {
    const { state, pool } = flakyPool();
    const lock = (await holdSingleInstance(pool, "iris-d2")) as InstanceLock;
    const seen: string[] = [];
    state.up = false;
    lock.watch({ retaken: () => seen.push("retaken"), lost: () => seen.push("lost") }, 20);
    await new Promise((r) => setTimeout(r, 150));
    expect(seen).toEqual([]);
    state.up = true;
    await lock.release();
  });
});
