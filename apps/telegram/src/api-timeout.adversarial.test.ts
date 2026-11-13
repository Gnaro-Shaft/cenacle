// A Telegram call that never answers is a network failure after a bound
// (lot C, 13/11), never a bot held forever.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CALL_TIMEOUT_MS, createTelegramApi, TelegramError } from "./api.ts";

const TOKEN = `123456789:${"A".repeat(35)}`;

function hanging() {
  const signals: AbortSignal[] = [];
  const fetchFn = ((_url: string, init: RequestInit) => {
    const signal = init.signal as AbortSignal;
    signals.push(signal);
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason));
    });
  }) as unknown as typeof fetch;
  return { fetchFn, signals };
}

describe("every call has a bound", () => {
  it("a call that hangs is a network failure once its time is out", async () => {
    const { fetchFn, signals } = hanging();
    const api = createTelegramApi(TOKEN, fetchFn);
    const started = Date.now();
    const sending = api.sendMessage(1, "x");
    expect(signals).toHaveLength(1);
    const error = await sending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TelegramError);
    expect((error as TelegramError).kind).toBe("network");
    expect((error as Error).message).not.toContain(TOKEN.split(":")[1]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(CALL_TIMEOUT_MS - 100);
  }, 30_000);

  it("a body that stalls after the headers is a network failure too", async () => {
    const fetchFn = ((_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"ok": tr'));
          signal.addEventListener("abort", () => controller.error(signal.reason));
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as unknown as typeof fetch;
    const error = await createTelegramApi(TOKEN, fetchFn)
      .sendMessage(1, "x")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TelegramError);
    expect((error as TelegramError).kind).toBe("network");
  }, 30_000);

  it("the long poll gets its own wait plus the margin, the others the margin", async () => {
    const seen: number[] = [];
    const real = AbortSignal.timeout;
    AbortSignal.timeout = (ms: number) => {
      seen.push(ms);
      return real.call(AbortSignal, ms);
    };
    try {
      const fetchFn = (async () =>
        new Response(JSON.stringify({ ok: true, result: [] }))) as unknown as typeof fetch;
      const api = createTelegramApi(TOKEN, fetchFn);
      await api.getUpdates(0, 25);
      await api.sendMessage(1, "x");
    } finally {
      AbortSignal.timeout = real;
    }
    expect(seen).toEqual([25_000 + CALL_TIMEOUT_MS, CALL_TIMEOUT_MS]);
  });

  it("the sentinel's alert is bounded too", () => {
    const main = readFileSync(join(import.meta.dirname, "../../sentinel/src/main.ts"), "utf8");
    expect(main).toMatch(/api\.telegram\.org[\s\S]{0,300}signal: AbortSignal\.timeout\(10_000\)/);
  });
});
