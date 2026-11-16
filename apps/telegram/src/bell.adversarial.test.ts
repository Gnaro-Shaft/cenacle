// The bell's heartbeat (ADR-0041, ADR-0002): the bot beats only after a pass
// that went to its end — a bell failing at every pass falls silent, and the
// sentinel says so. Reminders switched off, it still beats. A beat not taken
// is said once, and its return once — never every minute.
import { heartbeatFromEnv } from "@cenacle/core";
import { InvalidEventError } from "@cenacle/journal";
import { describe, expect, it } from "vitest";
import { type BellBeat, bellHeartbeat, bellMinute, createBellBeat } from "./bell.ts";

describe("the sentinel misconfigured never stops the bell", () => {
  const URL = "http://sentinelle.test:8790/battement";
  const SHORT = "secret-but-short";
  const made = (env: NodeJS.ProcessEnv) => {
    const logs: string[] = [];
    const hb = bellHeartbeat(
      () => heartbeatFromEnv("bot", env),
      (l) => logs.push(l),
    );
    return { hb, logs };
  };

  it.each([
    ["a token too short", { CENACLE_SENTINEL_URL: URL, CENACLE_SENTINEL_TOKEN: SHORT }],
    ["no token", { CENACLE_SENTINEL_URL: URL }],
    [
      "an address malformed",
      { CENACLE_SENTINEL_URL: "file:///etc/passwd", CENACLE_SENTINEL_TOKEN: "t".repeat(40) },
    ],
  ])("%s: the bot runs without it, said once, never a value", (_what, env) => {
    const { hb, logs } = made(env);
    expect(hb).toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/Sentinelle mal configurée .*CENACLE_SENTINEL_/);
    expect(logs[0]).not.toContain(SHORT);
    expect(logs[0]).not.toContain("t".repeat(32));
  });

  it("not configured: said, no beat", () => {
    const { hb, logs } = made({});
    expect(hb).toBeNull();
    expect(logs[0]).toMatch(/non configurée/);
  });

  it("configured: a heartbeat, nothing said", () => {
    const { hb, logs } = made({
      CENACLE_SENTINEL_URL: URL,
      CENACLE_SENTINEL_TOKEN: "t".repeat(40),
    });
    expect(hb).not.toBeNull();
    expect(logs).toEqual([]);
  });
});

function counting(): BellBeat & { count: number } {
  const b = {
    count: 0,
    async afterPass() {
      b.count++;
    },
  };
  return b;
}

describe("one minute of the bell", () => {
  it("a pass that went to its end: one beat, after it", async () => {
    const order: string[] = [];
    const beat = { afterPass: async () => void order.push("beat") };
    const ok = await bellMinute({
      pass: async () => void order.push("pass"),
      beat,
      log: () => {},
    });
    expect(ok).toBe(true);
    expect(order).toEqual(["pass", "beat"]);
  });

  it.each([
    ["the database away", new Error("connect ECONNREFUSED")],
    ["a thrown string", "boom"],
    [
      "a database error quoting its address",
      Object.assign(new Error("db-host:5432"), { name: "PostgresError" }),
    ],
  ])("a pass failing (%s): no beat, said by name only", async (_what, failure) => {
    const beat = counting();
    const logs: string[] = [];
    const ok = await bellMinute({
      pass: async () => {
        throw failure;
      },
      beat,
      log: (l) => logs.push(l),
    });
    expect(ok).toBe(false);
    expect(beat.count).toBe(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/passage manqué/);
    expect(logs[0]).not.toMatch(/ECONNREFUSED|db-host|5432|boom/);
  });

  it("failing at every pass: the bot never beats, so the sentinel speaks", async () => {
    const beat = counting();
    for (let i = 0; i < 15; i++) {
      await bellMinute({
        pass: async () => {
          throw new Error("x");
        },
        beat,
        log: () => {},
      });
    }
    expect(beat.count).toBe(0);
  });

  it("reminders switched off: nothing to ring, it still beats", async () => {
    const beat = counting();
    expect(await bellMinute({ pass: null, beat, log: () => {} })).toBe(true);
    expect(beat.count).toBe(1);
  });

  it("no sentinel configured: the pass still runs", async () => {
    let passed = 0;
    expect(await bellMinute({ pass: async () => void passed++, beat: null, log: () => {} })).toBe(
      true,
    );
    expect(passed).toBe(1);
  });

  it("a journal entry the code got wrong is a bug: it is not swallowed", async () => {
    const beat = counting();
    await expect(
      bellMinute({
        pass: async () => {
          throw new InvalidEventError("bad payload");
        },
        beat,
        log: () => {},
      }),
    ).rejects.toThrow(InvalidEventError);
    expect(beat.count).toBe(0);
  });
});

describe("the beat, told once per change", () => {
  const run = async (answers: boolean[]) => {
    const logs: string[] = [];
    let i = 0;
    const beat = createBellBeat({
      beat: async () => answers[i++] ?? true,
      log: (l) => logs.push(l),
    });
    for (const _ of answers) await beat.afterPass();
    return logs;
  };

  it("always taken: nothing said, not even at the first", async () => {
    expect(await run([true, true, true])).toEqual([]);
  });

  it("not taken for ten minutes: said once, not ten times", async () => {
    const logs = await run(Array(10).fill(false));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/n'a pas pris le battement du bot/);
  });

  it("an outage then its end: said once each, in that order", async () => {
    const logs = await run([true, false, false, true, true]);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatch(/n'a pas pris/);
    expect(logs[1]).toMatch(/reprend le battement/);
  });

  it("refused from the start (an old sentinel): said at once, and its return later", async () => {
    const logs = await run([false, true]);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatch(/pas encore à jour/);
    expect(logs[1]).toMatch(/reprend/);
  });

  it("each pass sends exactly one beat", async () => {
    let sent = 0;
    const beat = createBellBeat({
      beat: async () => {
        sent++;
        return sent % 2 === 0;
      },
      log: () => {},
    });
    for (let k = 0; k < 7; k++) await beat.afterPass();
    expect(sent).toBe(7);
  });
});
