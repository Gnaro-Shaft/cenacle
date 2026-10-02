import { describe, expect, it } from "vitest";
import { setupTracing } from "./tracing.ts";

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
