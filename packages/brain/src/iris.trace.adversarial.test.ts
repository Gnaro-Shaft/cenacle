import { SpanStatusCode, trace } from "@opentelemetry/api";
import { JsonTraceSerializer } from "@opentelemetry/otlp-transformer";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { askIris, SPAN_ATTRIBUTES } from "./iris.ts";
import { createLocalModels } from "./local-model.ts";
import { type FakeModelServer, fakeModelServer, memoryJournal } from "./test-helpers.ts";

// Spans leave the process (to Tempo): they must describe the work, never
// carry what was said.
const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
let server: FakeModelServer | undefined;

beforeAll(() => {
  trace.setGlobalTracerProvider(provider);
});
afterEach(async () => {
  exporter.reset();
  await server?.close();
  server = undefined;
});
afterAll(async () => {
  await provider.shutdown();
  trace.disable();
});

describe("iris.ask spans", () => {
  const SECRET = "IBAN-FR76-SECRET-CLIENT";

  it("record structure and counts, never the question or the answer", async () => {
    server = await fakeModelServer(`La réponse cite ${SECRET}`);
    const local = createLocalModels({ baseUrl: server.baseUrl, modelId: "m" });
    await askIris({
      question: `Question sur ${SECRET}`,
      dataClass: "mail_content",
      journal: memoryJournal(),
      local,
    });

    const spans = exporter.getFinishedSpans().filter((s) => s.name === "iris.ask");
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span?.attributes).toMatchObject({
      "cenacle.outcome": "answered",
      "cenacle.destination": "local",
    });
    // Exactly the bytes the OTLP exporter would send to Tempo.
    const wire = new TextDecoder().decode(
      JsonTraceSerializer.serializeRequest(exporter.getFinishedSpans()),
    );
    expect(wire).toContain("iris.ask");
    expect(wire).not.toContain(SECRET);
  });

  it("use only allow-listed attribute names", async () => {
    server = await fakeModelServer("ok");
    const local = createLocalModels({ baseUrl: server.baseUrl, modelId: "m" });
    await askIris({ question: "x", dataClass: "personal", journal: memoryJournal(), local });
    for (const span of exporter.getFinishedSpans().filter((s) => s.name === "iris.ask")) {
      for (const key of Object.keys(span.attributes)) {
        expect(SPAN_ATTRIBUTES as readonly string[]).toContain(key);
      }
    }
  });

  it("mark a failure as an error, without quoting the server's message", async () => {
    const local = createLocalModels({ baseUrl: "http://127.0.0.1:1/v1", modelId: "m" });
    await expect(
      askIris({ question: "x", dataClass: "personal", journal: memoryJournal(), local }),
    ).rejects.toThrow();
    const span = exporter.getFinishedSpans().find((s) => s.name === "iris.ask");
    expect(span?.status).toEqual({ code: SpanStatusCode.ERROR, message: "ModelUnavailableError" });
    expect(span?.attributes["cenacle.outcome"]).toBe("model_unavailable");
  });
});
