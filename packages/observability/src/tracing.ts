/**
 * Tracing setup (ADR-0008): spans go to the local Tempo, over OTLP/HTTP,
 * and nowhere else. Spans carry structure, durations and counts — never
 * content (enforced by tests on every instrumented module).
 */
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

export interface Tracing {
  /** Flushes pending spans; call before the process exits. */
  shutdown(): Promise<void>;
}

const NO_TRACING: Tracing = { shutdown: async () => {} };

/**
 * Flushes, and never throws (lot F5, 13/11): a Tempo that is not running made
 * `npm run ask` end on an uncaught ECONNREFUSED after its answer. Traces are a
 * help, not the work: one line says they were lost, the program ends well.
 */
export async function shutdownQuietly(
  provider: { shutdown(): Promise<void> },
  log: (line: string) => void,
): Promise<void> {
  try {
    await provider.shutdown();
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    const why = typeof code === "string" && /^[A-Z][A-Z0-9_]{1,39}$/.test(code) ? ` (${code})` : "";
    log(`⚠ Traces non envoyées : Tempo injoignable${why}.`);
  }
}

/**
 * Starts tracing if CENACLE_OTEL_ENDPOINT is set (e.g. http://127.0.0.1:4318).
 * Without it, tracing stays a no-op: instrumented code runs unchanged.
 */
export function setupTracing(serviceName: string, env = process.env): Tracing {
  const endpoint = env.CENACLE_OTEL_ENDPOINT;
  if (endpoint === undefined || endpoint === "") return NO_TRACING;
  const url = new URL("/v1/traces", endpoint);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`CENACLE_OTEL_ENDPOINT must be local (127.0.0.1), got ${url.hostname}`);
  }
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: url.toString() }))],
  });
  provider.register();
  return { shutdown: () => shutdownQuietly(provider, (line) => console.error(line)) };
}
