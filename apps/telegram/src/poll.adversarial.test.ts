// The bot survives a network cut (found on 2026-10-10: one `fetch failed`
// brought it down until launchd restarted it). Failures are classified, waits
// are bounded and growing, an outage is one line and Telegram's return
// another, a stop during a wait is immediate — and anything unexpected still
// throws.
import { describe, expect, it } from "vitest";
import { createTelegramApi, TelegramError, type TelegramUpdate } from "./api.ts";
import {
  MAX_NETWORK_DELAY_MS,
  MAX_RATE_LIMIT_DELAY_MS,
  retryDelayMs,
  sleepUnless,
  UNAUTHORIZED_DELAY_MS,
} from "./backoff.ts";
import { poll } from "./poll.ts";

const SECRET_PART = "AAHfake_token_for_tests_only_000000000";
const TOKEN = ["123456789", SECRET_PART].join(":");

function apiWith(respond: () => Promise<Response>) {
  return createTelegramApi(TOKEN, (() => respond()) as typeof fetch);
}
const json = (status: number, body: object) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("Telegram failures are classified, and the token never leaks", () => {
  it.each([
    ["a network cut", () => Promise.reject(new TypeError("fetch failed")), "network", undefined],
    ["Telegram down (502)", () => json(502, { ok: false }), "network", undefined],
    [
      "slowed down (429)",
      () => json(429, { ok: false, description: "Too Many", parameters: { retry_after: 17 } }),
      "rate_limited",
      17,
    ],
    [
      "a refused token (401)",
      () => json(401, { ok: false, description: "Unauthorized" }),
      "unauthorized",
      undefined,
    ],
    [
      "a rejected request (400)",
      () => json(400, { ok: false, description: "Bad Request" }),
      "rejected",
      undefined,
    ],
  ] as const)("%s", async (_, respond, kind, retryAfter) => {
    const error = await apiWith(respond)
      .getUpdates(0, 1)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TelegramError);
    expect(error).toMatchObject({ kind, retryAfterSeconds: retryAfter });
    expect(String((error as Error).message)).not.toContain(SECRET_PART);
  });
});

describe("retryDelayMs", () => {
  it("network: 2, 4, 8… s, capped at a minute, jitter within ±20 %", () => {
    const mid = () => 0.5;
    expect([1, 2, 3, 4].map((a) => retryDelayMs({ kind: "network" }, a, mid))).toEqual([
      2000, 4000, 8000, 16000,
    ]);
    expect(retryDelayMs({ kind: "network" }, 30, mid)).toBe(MAX_NETWORK_DELAY_MS);
    expect(retryDelayMs({ kind: "network" }, 30, () => 0.999)).toBe(MAX_NETWORK_DELAY_MS);
    expect(retryDelayMs({ kind: "network" }, 1, () => 0)).toBe(1600);
    expect(retryDelayMs({ kind: "network" }, 1, () => 0.999)).toBeLessThanOrEqual(2400);
  });

  it("slowed down: what Telegram asks, capped; a refused token: five minutes", () => {
    expect(retryDelayMs({ kind: "rate_limited", retryAfterSeconds: 17 }, 1)).toBe(17_000);
    expect(retryDelayMs({ kind: "rate_limited", retryAfterSeconds: 99_999 }, 1)).toBe(
      MAX_RATE_LIMIT_DELAY_MS,
    );
    expect(retryDelayMs({ kind: "unauthorized" }, 1)).toBe(UNAUTHORIZED_DELAY_MS);
  });

  it("sleepUnless stops at once when asked", async () => {
    let stop = false;
    setTimeout(() => {
      stop = true;
    }, 30);
    const started = Date.now();
    await sleepUnless(60_000, () => stop, 10);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

/** A fake Telegram: each call answers from the script, then the loop is stopped. */
function run(script: Array<TelegramUpdate[] | Error>) {
  const logs: string[] = [];
  const waits: number[] = [];
  const handled: number[] = [];
  const offsets: number[] = [];
  let i = 0;
  const done = poll({
    getUpdates: async (offset) => {
      offsets.push(offset);
      const step = script[i++];
      if (step instanceof Error) throw step;
      return step ?? [];
    },
    handle: async (u) => {
      handled.push(u.update_id);
    },
    stopped: () => i >= script.length,
    sleep: async (ms) => {
      waits.push(ms);
    },
    log: (l) => logs.push(l),
    random: () => 0.5,
  });
  return { done, logs, waits, handled, offsets };
}
const cut = () => new TelegramError("Telegram unreachable (getUpdates): fetch failed", "network");
const update = (id: number): TelegramUpdate => ({
  update_id: id,
  message: { message_id: id, chat: { id: 1, type: "private" }, text: "/etat" },
});

describe("poll", () => {
  it("a cut, then Telegram back: no crash, one line for the outage, one for the return", async () => {
    const r = run([cut(), cut(), cut(), [update(7)], [update(8)]]);
    await r.done;
    expect(r.waits).toEqual([2000, 4000, 8000]);
    expect(r.logs).toEqual([
      "⚠ Telegram injoignable (network) : nouvel essai dans 2 s",
      "✔ Telegram de nouveau joint, après 3 essai(s)",
    ]);
    expect(r.handled).toEqual([7, 8]);
    expect(r.offsets.at(-1)).toBe(8);
  });

  it("a refused token says so once, and waits five minutes", async () => {
    const r = run([new TelegramError("401", "unauthorized"), [update(1)]]);
    await r.done;
    expect(r.waits).toEqual([UNAUTHORIZED_DELAY_MS]);
    expect(r.logs[0]).toMatch(/refuse le jeton/);
  });

  it("an unexpected error still throws: launchd restarts the bot", async () => {
    const r = run([new RangeError("bug")]);
    await expect(r.done).rejects.toBeInstanceOf(RangeError);
  });

  it("a stop during a wait ends the loop at once", async () => {
    let stopped = false;
    const done = poll({
      getUpdates: async () => {
        throw cut();
      },
      handle: async () => {},
      stopped: () => stopped,
      sleep: (ms) => sleepUnless(ms, () => stopped, 10),
      log: () => {},
    });
    setTimeout(() => {
      stopped = true;
    }, 30);
    const started = Date.now();
    await done;
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("the offset moves past each update, so none is handled twice", async () => {
    const r = run([[update(3), update(4)], [update(5)], []]);
    await r.done;
    expect(r.offsets).toEqual([0, 5, 6]);
    expect(r.handled).toEqual([3, 4, 5]);
  });
});
