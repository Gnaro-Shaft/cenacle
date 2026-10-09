// The review in focused passes (J3b, ADR-0021): the code prepares one dossier
// per changed code file — the most changed first, capped — so that a huge file
// never displaces a small one; numbered excerpts point at the right lines;
// callers are found; one failing pass never costs the others.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalModels } from "@cenacle/brain";
import { fakeModelServer, memoryJournal } from "@cenacle/brain/test-helpers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCto } from "./pipeline.ts";
import { gitView } from "./repo-view.ts";
import { rangeTarget } from "./review.ts";
import { buildPasses, MAX_REVIEWED_FILES, QUESTIONS } from "./review-passes.ts";

let root = "";
const git = (...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { stdio: "pipe" })
    .toString()
    .trim();
const put = (path: string, text: string) => {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), text);
};
const commit = (message: string) => {
  git("add", "-f", "-A");
  git("-c", "user.email=t@t.test", "-c", "user.name=t", "commit", "-q", "-m", message);
};
const lines = (n: number, tag: string) =>
  Array.from({ length: n }, (_, i) => `export const ${tag}${i} = ${i};`).join("\n");

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cto-passes-"));
  git("init", "-q", "-b", "main");
  put("package.json", '{"scripts":{}}');
  put("docs/charte.md", "La charte.");
  put("src/long.ts", lines(600, "l"));
  put("src/petit.ts", "export const p = 1;\n");
  put("src/user.ts", "import { p } from './petit.ts';\n");
  commit("init");
  // The change: a huge generated file, a small real change, a long file touched far
  // down, a new exported name used elsewhere, docs, and more code files than the cap.
  put("src/genere.ts", lines(3000, "g"));
  put(
    "src/petit.ts",
    "export const p = 2; // changé\nexport function nouveauNom() { return 1; }\n",
  );
  put("src/user.ts", "import { nouveauNom, p } from './petit.ts';\nnouveauNom();\n");
  put(
    "src/long.ts",
    lines(600, "l").replace("export const l500 = 500;", "export const l500 = 5000;"),
  );
  put("docs/notes.md", "# Notes\n");
  // One changed line each: fewer changes than every real file above, so they fill the cap last.
  for (let i = 0; i < MAX_REVIEWED_FILES; i++) put(`src/extra${i}.ts`, lines(1, `x${i}_`));
  commit("change");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const target = () => rangeTarget(root, "HEAD^", "HEAD", "change");

describe("buildPasses", () => {
  it("code files only, the most changed first, capped; the rest named", () => {
    const { passes, skipped } = buildPasses(target(), gitView(root, "HEAD"));
    expect(passes).toHaveLength(MAX_REVIEWED_FILES);
    expect(passes[0]?.label).toBe("src/genere.ts");
    expect(skipped).toContain("docs/notes.md");
    expect(passes.map((p) => p.label)).not.toContain("docs/notes.md");
    expect(skipped.length).toBeGreaterThan(1);
  });

  it("a huge file never displaces the small change: each file has its own pass and diff", () => {
    const { passes } = buildPasses(target(), gitView(root, "HEAD"));
    const small = passes.find((p) => p.label === "src/petit.ts");
    expect(small?.prompt).toContain("// changé");
    expect(small?.prompt).not.toContain("export const g2999");
    // Its own diff only: no other file's diff ever enters its pass.
    expect(small?.prompt).not.toContain("diff --git a/src/user.ts");
    expect(small?.prompt).not.toContain("diff --git a/src/genere.ts");
  });

  it("a long file: numbered windows around the hunk, with the right line numbers", () => {
    const { passes } = buildPasses(target(), gitView(root, "HEAD"));
    const long = passes.find((p) => p.label === "src/long.ts")?.prompt ?? "";
    expect(long).toContain("501: export const l500 = 5000;");
    expect(long).not.toContain("1: export const l0 = 0;\n");
  });

  it("callers of a new exported name are found, never in the file itself", () => {
    const { passes } = buildPasses(target(), gitView(root, "HEAD"));
    const small = passes.find((p) => p.label === "src/petit.ts")?.prompt ?? "";
    expect(small).toMatch(/nouveauNom :\nsrc\/user\.ts:\d+/);
    expect(small).not.toMatch(/nouveauNom :\nsrc\/petit\.ts/);
  });

  it("every pass asks the fixed questions about its own file only", () => {
    const { passes } = buildPasses(target(), gitView(root, "HEAD"));
    for (const p of passes) {
      expect(p.prompt).toContain(`\`${p.label}\``);
      for (const q of QUESTIONS) expect(p.prompt).toContain(q);
    }
  });
});

describe("runCto with passes", () => {
  it("gathers findings by file; 'no defect' is collapsed; one ask per pass", async () => {
    const server = await fakeModelServer((body) =>
      body.includes("Relis src/a.ts")
        ? "Important — `src/a.ts:1` : une erreur est avalée."
        : "Aucun défaut dans ce fichier.",
    );
    try {
      const local = createLocalModels({ baseUrl: server.baseUrl, modelId: "test-model" });
      const reply = await runCto(
        "ignored",
        gitView(root, "HEAD"),
        { root, journal: memoryJournal(), local },
        {
          kind: "review",
          passes: [
            { label: "src/a.ts", prompt: "Relis src/a.ts" },
            { label: "src/b.ts", prompt: "Relis src/b.ts" },
          ],
        },
      );
      expect(reply.text).toContain("## `src/a.ts`");
      expect(reply.text).toContain("une erreur est avalée");
      expect(reply.text).toMatch(/Sans constat : `src\/b\.ts`/);
      expect(server.requests).toHaveLength(2);
    } finally {
      await server.close();
    }
  });

  it("a pass whose model fails: said in its section, the next pass still runs", async () => {
    let n = 0;
    const server = await fakeModelServer(() => {
      n++;
      return n === 1 ? "" : "Mineur — `src/petit.ts:1` : un cas oublié.";
    });
    try {
      const local = createLocalModels({ baseUrl: server.baseUrl, modelId: "test-model" });
      const reply = await runCto(
        "ignored",
        gitView(root, "HEAD"),
        { root, journal: memoryJournal(), local },
        {
          kind: "review",
          passes: [
            { label: "src/user.ts", prompt: "Relis src/user.ts" },
            { label: "src/petit.ts", prompt: "Relis src/petit.ts" },
          ],
        },
      );
      expect(reply.text).toMatch(/## `src\/user\.ts`\n\n\(relecture de ce fichier interrompue/);
      expect(reply.text).toContain("un cas oublié");
    } finally {
      await server.close();
    }
  });
});
