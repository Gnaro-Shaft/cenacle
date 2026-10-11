// Preparing a fix (J6c), with a real git: a repository and a local remote in
// a temporary folder; npm and gh are stand-in scripts (no network, no real
// pull request). The checkout I run from is never touched; only package
// files may change; whatever fails, the working copy goes and an unpushed
// branch is removed; and no code of the security agent ever merges or
// forces a push.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runProgram } from "./checks.ts";
import { branchFor, prepareFix } from "./fix.ts";

const BASE = mkdtempSync(join(tmpdir(), "cenacle-fix-test-"));
afterAll(() => rmSync(BASE, { recursive: true, force: true }));
const GIT = execFileSync("/bin/sh", ["-c", "command -v git"]).toString().trim();
const git = (cwd: string, ...args: string[]) => execFileSync(GIT, args, { cwd }).toString().trim();

let n = 0;
/** A repository with a remote holding main, and stand-in npm and gh scripts. */
function world(npmEdits: string[], ghOutput = "https://github.com/owner/repo/pull/42") {
  n += 1;
  const remote = join(BASE, `remote-${n}.git`);
  const root = join(BASE, `root-${n}`);
  git(BASE, "init", "--quiet", "--bare", "-b", "main", remote);
  git(BASE, "init", "--quiet", "-b", "main", root);
  git(root, "config", "user.email", "agent@example.test");
  git(root, "config", "user.name", "Agent");
  writeFileSync(join(root, "package.json"), '{ "name": "x" }\n');
  writeFileSync(join(root, "package-lock.json"), '{ "lockfileVersion": 3 }\n');
  writeFileSync(join(root, "README.md"), "x\n");
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "init");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "--quiet", "-u", "origin", "main");
  const bin = join(BASE, `bin-${n}`);
  execFileSync("/bin/mkdir", ["-p", bin]);
  const npm = join(bin, "npm");
  writeFileSync(
    npm,
    `#!/bin/sh\necho "$@" > "${bin}/npm-args"\n${npmEdits.map((f) => `echo changed >> "${f}"`).join("\n")}\n`,
  );
  const gh = join(bin, "gh");
  writeFileSync(gh, `#!/bin/sh\necho "$@" > "${bin}/gh-args"\necho "${ghOutput}"\n`);
  chmodSync(npm, 0o755);
  chmodSync(gh, 0o755);
  const deps = { run: runProgram(60_000), root, tmpRoot: BASE, git: GIT, npm, gh };
  return { root, remote, bin, deps };
}
const worktrees = (root: string) => git(root, "worktree", "list").split("\n").length;
const tempCopies = () => readdirSync(BASE).filter((f) => f.startsWith("cenacle-correctif-")).length;

describe("preparing a fix", () => {
  it("the lock file updated in a copy of its own, pushed on its branch, a PR opened", async () => {
    const w = world(["package-lock.json"]);
    const before = git(w.root, "status", "--porcelain");
    const r = await prepareFix({ findingId: 7, name: "left-pad", version: "1.3.1" }, w.deps);
    expect(r).toEqual({
      ok: true,
      url: "https://github.com/owner/repo/pull/42",
      branch: "securite/correctif-left-pad-1.3.1",
    });
    expect(readFileSync(join(w.bin, "npm-args"), "utf8").trim()).toBe(
      "install left-pad@1.3.1 --package-lock-only --ignore-scripts --no-audit --no-fund",
    );
    expect(git(w.remote, "log", "--format=%s", "-1", "securite/correctif-left-pad-1.3.1")).toMatch(
      /constat n°7/,
    );
    expect(git(w.remote, "log", "--format=%s", "-1", "main")).toBe("init");
    expect(git(w.root, "status", "--porcelain")).toBe(before);
    expect(worktrees(w.root)).toBe(1);
    expect(tempCopies()).toBe(0);
    expect(readFileSync(join(w.bin, "gh-args"), "utf8")).toMatch(
      /^pr create --base main --head securite\/correctif-left-pad-1\.3\.1/,
    );
  });

  it("a change to anything but package files: abandoned before any push", async () => {
    const w = world(["package-lock.json", "README.md"]);
    expect(await prepareFix({ findingId: 1, name: "left-pad", version: "1.3.1" }, w.deps)).toEqual({
      ok: false,
      step: "diff",
    });
    expect(() =>
      git(w.remote, "rev-parse", "--verify", "securite/correctif-left-pad-1.3.1"),
    ).toThrow();
    expect(() =>
      git(w.root, "rev-parse", "--verify", "securite/correctif-left-pad-1.3.1"),
    ).toThrow();
    expect(worktrees(w.root)).toBe(1);
    expect(tempCopies()).toBe(0);
  });

  it("nothing changed: nothing pushed", async () => {
    const w = world([]);
    expect(
      (await prepareFix({ findingId: 1, name: "left-pad", version: "1.3.1" }, w.deps)).ok,
    ).toBe(false);
    expect(() =>
      git(w.remote, "rev-parse", "--verify", "securite/correctif-left-pad-1.3.1"),
    ).toThrow();
  });

  it("a PR that cannot be opened: said, the pushed branch stays for me to see", async () => {
    const w = world(["package-lock.json"], "error: something went wrong");
    expect(await prepareFix({ findingId: 1, name: "left-pad", version: "1.3.1" }, w.deps)).toEqual({
      ok: false,
      step: "pr",
    });
    expect(git(w.remote, "rev-parse", "--verify", "securite/correctif-left-pad-1.3.1")).toMatch(
      /^[0-9a-f]{40}$/,
    );
    expect(tempCopies()).toBe(0);
  });

  it("a name or version that cannot make a branch is refused before anything", () => {
    expect(branchFor("left-pad", "1.3.1")).toBe("securite/correctif-left-pad-1.3.1");
    expect(branchFor("@scope/pkg", "2.0.0")).toBe("securite/correctif-scope-pkg-2.0.0");
    expect(branchFor("x; rm", "1.0.0")).toBeNull();
    expect(branchFor("x", "1.0.0 --force")).toBeNull();
  });
});

describe("the security agent merges only on my button, never forces", () => {
  const dir = join(import.meta.dirname);
  const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("merging exists in merge.ts only, and only the actions' wiring imports it (J6d)", () => {
    for (const file of sources) {
      const text = readFileSync(join(dir, file), "utf8");
      if (file !== "merge.ts") expect(text, file).not.toMatch(/["'`]merge["'`]/);
      // A type may be shared; the code that merges is imported by the wiring only.
      if (file !== "actions-deps.ts") {
        expect(text, file).not.toMatch(/^import (?!type )[^\n]*from "\.\/merge\.ts"/m);
      }
    }
    // The merge names the commit I saw: anything pushed after fails it.
    expect(readFileSync(join(dir, "merge.ts"), "utf8")).toMatch(/"--match-head-commit",\s*sha/);
  });

  it("no force push, no push to main anywhere in its code", () => {
    for (const file of sources) {
      const text = readFileSync(join(dir, file), "utf8");
      expect(text, file).not.toMatch(/["'`]--force-with-lease["'`]|["'`]-f["'`]/);
      expect(text, file).not.toMatch(/push[^\n]*["'`](?:main|--force)["'`]/);
    }
  });
});
