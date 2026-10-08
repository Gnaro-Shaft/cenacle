// What the CTO reads is chosen by code (ADR-0017): never a secret file, a
// symbolic link, a path outside the repository, a binary or oversized file,
// or text that looks like a credential — whatever git tracks.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProjectContext } from "./context.ts";

let root = "";
let outside = "";
const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
const put = (path: string, text: string | Buffer) => {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), text);
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cto-context-"));
  outside = mkdtempSync(join(tmpdir(), "cto-outside-"));
  writeFileSync(join(outside, "secret.md"), "hors du dépôt");
  git("init", "-q");
  put("README.md", "# Projet\nLe lisez-moi.");
  put("CLAUDE.md", "Règles pour les agents.");
  put("docs/charte.md", "La charte.");
  put("docs/adr/0002-b.md", "ADR deux.");
  put("docs/adr/0001-a.md", "ADR un.");
  put("docs/guide.md", "Un guide.");
  put("src/code.ts", "export const x = 1;");
  put(".env", "CENACLE_MAIL_KEY=aaaaaaaaaaaaaaaa");
  put("docs/.env.md", "fichier env déguisé");
  put("docs/cadre.local.toml", "host = 'x'");
  put("docs/fixtures/mails.md", "des mails fictifs");
  put("docs/cle.md", "-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----");
  put("docs/mdp.md", "Le mot de passe : password = Sup3rS3cretValue2026");
  put("docs/jeton.md", "jeton ghp_abcdefghijklmnopqrstuvwxyz0123");
  put("docs/binaire.md", Buffer.from([0x23, 0x00, 0x01, 0x02]));
  put("docs/gros.md", "x".repeat(200_001));
  symlinkSync("../.env", join(root, "docs/lien.md"));
  symlinkSync(outside, join(root, "docs/ailleurs"));
  git("add", "-f", "-A");
  git("-c", "user.email=t@t.test", "-c", "user.name=t", "commit", "-q", "-m", "init");
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("loadProjectContext", () => {
  it("reads the documentation only, charter and decisions first, in a fixed order", () => {
    const c = loadProjectContext(root);
    expect(c.files.map((f) => f.path)).toEqual([
      "CLAUDE.md",
      "README.md",
      "docs/charte.md",
      "docs/adr/0001-a.md",
      "docs/adr/0002-b.md",
      "docs/guide.md",
    ]);
    expect(loadProjectContext(root)).toEqual(c);
  });

  it("never code, never an untracked file", () => {
    put("docs/pas-suivi.md", "non versionné");
    const paths = loadProjectContext(root).files.map((f) => f.path);
    expect(paths).not.toContain("src/code.ts");
    expect(paths).not.toContain("docs/pas-suivi.md");
  });

  it.each([
    ["docs/.env.md", "denied"],
    ["docs/cadre.local.toml", "absent"],
    ["docs/fixtures/mails.md", "denied"],
    ["docs/lien.md", "symlink"],
    ["docs/cle.md", "secret_like"],
    ["docs/mdp.md", "secret_like"],
    ["docs/jeton.md", "secret_like"],
    ["docs/binaire.md", "binary"],
    ["docs/gros.md", "too_big"],
  ])("%s is never read (%s)", (path, reason) => {
    const c = loadProjectContext(root);
    expect(c.files.map((f) => f.path)).not.toContain(path);
    if (reason !== "absent") expect(c.skipped).toContainEqual({ path, reason });
  });

  it("nothing of a skipped file leaks into what is returned", () => {
    const all = JSON.stringify(loadProjectContext(root));
    for (const secret of [
      "aaaaaaaaaaaaaaaa",
      "Sup3rS3cret",
      "ghp_abc",
      "MIIabc",
      "hors du dépôt",
      "fichier env",
    ]) {
      expect(all).not.toContain(secret);
    }
  });

  it("a path git lists outside the repository, or absolute, is refused", () => {
    const c = loadProjectContext(root, {
      tracked: () => ["docs/../../../etc/passwd.md", "/etc/docs/x.md", "docs/ailleurs/secret.md"],
    });
    // Nothing is read; an absolute path is not even a candidate (not documentation).
    expect(c.files).toEqual([]);
    expect(c.skipped.length).toBeGreaterThan(0);
    expect(c.skipped.every((s) => s.reason === "outside")).toBe(true);
  });

  it("the budget is never exceeded; what does not fit is reported", () => {
    const c = loadProjectContext(root, { budget: 50 });
    expect(c.chars).toBeLessThanOrEqual(50);
    expect(c.skipped.some((s) => s.reason === "budget")).toBe(true);
  });

  it("a repository that is not one fails loudly (no silent empty context)", () => {
    const empty = mkdtempSync(join(tmpdir(), "cto-nogit-"));
    expect(() => loadProjectContext(empty)).toThrow();
    rmSync(empty, { recursive: true, force: true });
  });
});
