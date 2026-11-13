import { describe, expect, it } from "vitest";
import { setupTracing, shutdownQuietly } from "./tracing.ts";

describe("setupTracing — adversarial", () => {
  it("does nothing without an endpoint", async () => {
    await expect(setupTracing("test", {}).shutdown()).resolves.toBeUndefined();
  });

  it.each(["http://tempo.example.com:4318", "http://100.64.0.1:4318", "https://0.0.0.0:4318"])(
    "refuses to send traces to a non-local endpoint (%s)",
    (endpoint) => {
      expect(() => setupTracing("test", { CENACLE_OTEL_ENDPOINT: endpoint })).toThrow(/local/);
    },
  );
});

describe("shutdown never throws (lot F5, 13/11)", () => {
  it("Tempo away: one line, and the program ends well", async () => {
    const lines: string[] = [];
    const away = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:4318"), {
      code: "ECONNREFUSED",
    });
    await expect(
      shutdownQuietly({ shutdown: async () => Promise.reject(away) }, (l) => lines.push(l)),
    ).resolves.toBeUndefined();
    expect(lines).toEqual(["⚠ Traces non envoyées : Tempo injoignable (ECONNREFUSED)."]);
  });

  it("a code that is not an identifier is not quoted", async () => {
    const lines: string[] = [];
    const odd = Object.assign(new Error("x"), { code: "someone@example.test" });
    await shutdownQuietly({ shutdown: async () => Promise.reject(odd) }, (l) => lines.push(l));
    expect(lines).toEqual(["⚠ Traces non envoyées : Tempo injoignable."]);
  });

  it("a shutdown that works says nothing", async () => {
    const lines: string[] = [];
    await shutdownQuietly({ shutdown: async () => {} }, (l) => lines.push(l));
    expect(lines).toEqual([]);
  });
});
