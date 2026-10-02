import { projectStatus } from "@cenacle/core";
import { afterEach, describe, expect, it } from "vitest";
import { askIris } from "./iris.ts";
import { createLocalModels } from "./local-model.ts";
import { type FakeModelServer, fakeModelServer, memoryJournal } from "./test-helpers.ts";

let server: FakeModelServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("askIris", () => {
  it("returns the local model's answer and journals thinking then idle", async () => {
    server = await fakeModelServer("Bonjour, je suis Iris.");
    const journal = memoryJournal();
    const local = createLocalModels({ baseUrl: server.baseUrl, modelId: "test-model" });

    const answer = await askIris({
      question: "Qui es-tu ?",
      dataClass: "personal",
      journal,
      local,
    });

    expect(answer).toBe("Bonjour, je suis Iris.");
    expect(journal.events.map((e) => e.type)).toEqual([
      "model.routed",
      "state.changed",
      "model.answered",
      "state.changed",
    ]);
    expect(projectStatus("iris", journal.events).view.visual).toBe("resting");
  });

  it("sends the system prompt and the question to the model", async () => {
    server = await fakeModelServer("ok");
    const local = createLocalModels({ baseUrl: server.baseUrl, modelId: "test-model" });
    await askIris({ question: "Ping ?", dataClass: "personal", journal: memoryJournal(), local });
    expect(server.requests[0]).toContain("Tu es Iris");
    expect(server.requests[0]).toContain("Ping ?");
  });
});
