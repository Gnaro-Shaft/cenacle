// S2: the Mac's heartbeat says who and when, nothing more; it never throws,
// and a half-configured sentinel is an error, not a silent skip.
import { describe, expect, it } from "vitest";
import { createHeartbeat, heartbeatFromEnv } from "./heartbeat.ts";

const NOW = new Date("2026-10-05T10:00:00.000Z");
const TOKEN = "t".repeat(40);

describe("heartbeat", () => {
  it("sends exactly the program and the time, with the token", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const hb = createHeartbeat({
      url: "http://sentinelle.test:8790/battement",
      token: TOKEN,
      program: "executor",
      now: () => NOW,
      fetch: async (url, init) => {
        sent.push({ url: String(url), init: init ?? {} });
        return new Response(null, { status: 204 });
      },
    });
    expect(await hb.beat()).toBe(true);
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({
      program: "executor",
      at: NOW.toISOString(),
    });
    const headers = (sent[0]?.init.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("never throws: a refused beat or an unreachable sentinel is false", async () => {
    const refused = createHeartbeat({
      url: "http://s.test/battement",
      token: TOKEN,
      program: "iris",
      fetch: async () => new Response(null, { status: 401 }),
    });
    expect(await refused.beat()).toBe(false);
    const down = createHeartbeat({
      url: "http://s.test/battement",
      token: TOKEN,
      program: "iris",
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(await down.beat()).toBe(false);
  });

  it("not configured: none; half configured or malformed: an error", () => {
    expect(heartbeatFromEnv("iris", {})).toBeNull();
    expect(() =>
      heartbeatFromEnv("iris", { CENACLE_SENTINEL_URL: "http://s.test:8790/battement" }),
    ).toThrow(/CENACLE_SENTINEL_TOKEN/);
    expect(() =>
      heartbeatFromEnv("iris", {
        CENACLE_SENTINEL_URL: "ftp://s.test",
        CENACLE_SENTINEL_TOKEN: TOKEN,
      }),
    ).toThrow(/must look like/);
    expect(
      heartbeatFromEnv("iris", {
        CENACLE_SENTINEL_URL: "http://s.test:8790/battement",
        CENACLE_SENTINEL_TOKEN: TOKEN,
      }),
    ).not.toBeNull();
  });
});
