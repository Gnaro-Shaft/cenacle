import { projectStatus } from "@cenacle/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { askIris, ModelUnavailableError } from "./iris.ts";
import { createLocalModels } from "./local-model.ts";
import { type FakeModelServer, fakeModelServer, memoryJournal } from "./test-helpers.ts";

let server: FakeModelServer | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await server?.close();
  server = undefined;
});

describe("askIris — adversarial", () => {
  it("falls sick, and does not fall back anywhere, when the local model is down", async () => {
    const journal = memoryJournal();
    // Port 1 on loopback: nothing listens there.
    const local = createLocalModels({ baseUrl: "http://127.0.0.1:1/v1", modelId: "m" });
    await expect(askIris({ question: "x", dataClass: "personal", journal, local })).rejects.toThrow(
      ModelUnavailableError,
    );
    const status = projectStatus("iris", journal.events);
    expect(status.view.visual).toBe("sick");
  });

  it("never writes the question or the answer into the journal", async () => {
    const secret = "MOT-DE-PASSE-CLIENT-42";
    server = await fakeModelServer(`Réponse contenant ${secret}`);
    const journal = memoryJournal();
    const local = createLocalModels({ baseUrl: server.baseUrl, modelId: "m" });
    await askIris({
      question: `Question avec ${secret}`,
      dataClass: "mail_content",
      journal,
      local,
    });
    expect(
      JSON.stringify(journal.events, (_k, v) => (typeof v === "bigint" ? String(v) : v)),
    ).not.toContain(secret);
  });

  it("only ever talks to the configured local address", async () => {
    server = await fakeModelServer("ok");
    const urls: string[] = [];
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      urls.push(input instanceof Request ? input.url : String(input));
      return realFetch(input, init);
    });
    const local = createLocalModels({ baseUrl: server.baseUrl, modelId: "m" });
    await askIris({ question: "x", dataClass: "personal", journal: memoryJournal(), local });
    expect(server.requests).toHaveLength(1);
    for (const url of urls) expect(url.startsWith(server.baseUrl)).toBe(true);
  });
});
