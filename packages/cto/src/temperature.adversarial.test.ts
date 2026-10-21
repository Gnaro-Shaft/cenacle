// The CTO never inherits the model server's temperature: Ollama's Modelfile for
// qwen3.8 says 1, measured worse for him than 0.7 (2026-10-20). Every ask he
// makes — a question, each pass of a review — carries his own.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalModels } from "@cenacle/brain";
import { fakeModelServer, memoryJournal } from "@cenacle/brain/test-helpers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CTO_TEMPERATURE, runCto } from "./pipeline.ts";
import { gitView } from "./repo-view.ts";

let root = "";
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cto-temperature-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  writeFileSync(join(root, "package.json"), '{"scripts":{}}');
  writeFileSync(join(root, "README.md"), "# Projet fictif\n");
  git("add", "-A");
  git("-c", "user.email=t@t.test", "-c", "user.name=t", "commit", "-q", "-m", "init");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const temperatures = (requests: readonly string[]) =>
  requests.map((body) => (JSON.parse(body) as { temperature?: unknown }).temperature);

describe("the CTO's temperature", () => {
  it("is 0.7, a value the server accepts", () => {
    expect(CTO_TEMPERATURE).toBe(0.7);
  });

  it("a question carries it", async () => {
    const server = await fakeModelServer("Réponse fictive.");
    try {
      const local = createLocalModels({ baseUrl: server.baseUrl, modelId: "test-model" });
      await runCto("Une question ?", gitView(root, "HEAD"), {
        root,
        journal: memoryJournal(),
        local,
      });
      expect(server.requests.length).toBeGreaterThan(0);
      expect(new Set(temperatures(server.requests))).toEqual(new Set([CTO_TEMPERATURE]));
    } finally {
      await server.close();
    }
  });

  it("every pass of a review carries it", async () => {
    const server = await fakeModelServer("Aucun défaut dans ce fichier.");
    try {
      const local = createLocalModels({ baseUrl: server.baseUrl, modelId: "test-model" });
      await runCto(
        "ignored",
        gitView(root, "HEAD"),
        { root, journal: memoryJournal(), local },
        {
          kind: "review",
          passes: [
            { label: "a.ts", prompt: "Relis a.ts" },
            { label: "b.ts", prompt: "Relis b.ts" },
          ],
        },
      );
      expect(temperatures(server.requests)).toEqual([CTO_TEMPERATURE, CTO_TEMPERATURE]);
    } finally {
      await server.close();
    }
  });
});
