// Every agent goes through the same local-only, journaled path (phase 6): the
// CTO is journaled as "cto" with his own instructions, Iris is unchanged, a
// bad agent name is refused, and the journal never holds the question or the answer.
import { projectStatus } from "@cenacle/core";
import { afterEach, describe, expect, it } from "vitest";
import { askAgent, askIris } from "./iris.ts";
import { createLocalModels } from "./local-model.ts";
import { type FakeModelServer, fakeModelServer, memoryJournal } from "./test-helpers.ts";

let server: FakeModelServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("askAgent", () => {
  it("the CTO: journaled as cto, with his own instructions, nothing of the text in the journal", async () => {
    server = await fakeModelServer("Réponse confidentielle du CTO.");
    const journal = memoryJournal();
    const local = createLocalModels({ baseUrl: server.baseUrl, modelId: "test-model" });
    const answer = await askAgent({
      agent: "cto",
      systemPrompt: "Tu es le CTO. CONSIGNE-TEST",
      question: "Question secrète sur l'architecture ?",
      dataClass: "personal",
      journal,
      local,
    });
    expect(answer.text).toBe("Réponse confidentielle du CTO.");
    expect(new Set(journal.events.map((e) => e.agent))).toEqual(new Set(["cto"]));
    expect(server.requests[0]).toContain("CONSIGNE-TEST");
    expect(server.requests[0]).not.toContain("Tu es Iris");
    const payloads = JSON.stringify(journal.events.map((e) => e.payload));
    expect(payloads).not.toMatch(/secrète|confidentielle|CONSIGNE/);
    expect(JSON.parse(payloads)[0]).toMatchObject({ destination: "local" });
    expect(projectStatus("cto", journal.events).view.visual).toBe("resting");
  });

  it("Iris is unchanged: her name and her instructions", async () => {
    server = await fakeModelServer("ok");
    const journal = memoryJournal();
    const local = createLocalModels({ baseUrl: server.baseUrl, modelId: "test-model" });
    await askIris({ question: "x", dataClass: "personal", journal, local });
    expect(new Set(journal.events.map((e) => e.agent))).toEqual(new Set(["iris"]));
    expect(server.requests[0]).toContain("Tu es Iris");
  });

  it.each(["CTO", "", "cto agent", "../iris", "a".repeat(33), "1cto"])(
    "refuses the agent name %j before asking anything",
    async (agent) => {
      server = await fakeModelServer("ok");
      const local = createLocalModels({ baseUrl: server.baseUrl, modelId: "test-model" });
      expect(() =>
        askAgent({ agent, question: "x", dataClass: "personal", journal: memoryJournal(), local }),
      ).toThrow(/invalid agent name/);
      expect(server.requests).toEqual([]);
    },
  );

  it("the model unreachable: an explicit error, and the CTO shows sick", async () => {
    const journal = memoryJournal();
    const local = createLocalModels({ baseUrl: "http://127.0.0.1:9/v1", modelId: "absent" });
    await expect(
      askAgent({ agent: "cto", question: "x", dataClass: "personal", journal, local }),
    ).rejects.toThrow(/did not answer/);
    expect(projectStatus("cto", journal.events).view.visual).toBe("sick");
  });
});

describe("an empty answer is a failure, never a silent success", () => {
  it("the CTO shows sick and the caller gets an explicit error", async () => {
    server = await fakeModelServer("");
    const journal = memoryJournal();
    const local = createLocalModels({ baseUrl: server.baseUrl, modelId: "test-model" });
    await expect(
      askAgent({ agent: "cto", question: "x", dataClass: "personal", journal, local }),
    ).rejects.toThrow(/empty_answer/);
    expect(projectStatus("cto", journal.events).view.visual).toBe("sick");
    expect(journal.events.some((e) => e.type === "model.answered")).toBe(false);
  });

  it("the window and the answer size can be raised per program; Iris keeps hers", () => {
    const iris = createLocalModels({ baseUrl: "http://127.0.0.1:1/v1", modelId: "m" });
    const cto = createLocalModels({
      baseUrl: "http://127.0.0.1:1/v1",
      modelId: "m",
      contextWindow: 131_072,
      maxTokens: 4096,
    });
    expect([iris.model.contextWindow, iris.model.maxTokens]).toEqual([32768, 2048]);
    expect([cto.model.contextWindow, cto.model.maxTokens]).toEqual([131_072, 4096]);
  });
});
