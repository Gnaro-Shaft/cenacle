// My other projects at the round (J6e2), with a real git and a real gitleaks
// on throwaway repositories (skipped where gitleaks is not installed, as on
// the CI), npm as a stand-in script: the list read from the root, unreadable
// said as a finding, never a failed round; npm audits the lock file only; a
// committed secret found and never shown; a project's dependencies wait for
// the morning report, a leak speaks at once; the CTO comments the worst five.
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StoredFinding } from "@cenacle/journal";
import type { Observation } from "@cenacle/securite";
import { afterAll, describe, expect, it } from "vitest";
import {
  GITLEAKS,
  loadProjects,
  PROJECTS_FILE,
  projectSpecs,
  projectsResult,
  runChecks,
  runProgram,
} from "./checks.ts";
import { MAX_COMMENTS, runRound } from "./round.ts";
import { world } from "./test-world.ts";

const BASE = mkdtempSync(join(tmpdir(), "cenacle-projets-test-"));
afterAll(() => rmSync(BASE, { recursive: true, force: true }));
const GIT = execFileSync("/bin/sh", ["-c", "command -v git"]).toString().trim();
// Built from pieces: no secret-looking line in this repository.
const SECRET = ["AKIA", "QWERTYUIOP", "ASDFGH"].join("");

function repo(name: string, files: Record<string, string>): string {
  const dir = join(BASE, name);
  mkdirSync(dir);
  const git = (...args: string[]) => execFileSync(GIT, args, { cwd: dir });
  git("init", "--quiet", "-b", "main");
  git("config", "user.email", "agent@example.test");
  git("config", "user.name", "Agent");
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
  git("add", ".");
  git("commit", "--quiet", "-m", "init");
  return dir;
}

describe("the list of my projects, at the root", () => {
  it("absent: no project, no finding; unreadable: the 'projets' check could not run", () => {
    const root = join(BASE, "root");
    mkdirSync(root);
    expect(loadProjects(root)).toEqual([]);
    expect(projectsResult([])).toEqual({ check: "projets", ran: true, observations: [] });
    writeFileSync(join(root, PROJECTS_FILE), '[[projet]]\nnom = "Mon Site"\n');
    expect(loadProjects(root)).toBeNull();
    expect(projectsResult(null)).toEqual({ check: "projets", ran: false });
  });
});

describe.skipIf(!existsSync(GITLEAKS))("a real gitleaks on a throwaway repository", () => {
  it("a committed secret: found, its value nowhere; a clean project: nothing", async () => {
    const leaky = repo("fuyant", { "app.js": `const k = "${SECRET}";\n` });
    const clean = repo("propre", { "app.js": "const k = process.env.KEY;\n" });
    const [a, b] = await runChecks(
      projectSpecs(
        [
          { name: "fuyant", path: leaky, npm: false, secrets: true },
          { name: "propre", path: clean, npm: false, secrets: true },
        ],
        "/nowhere",
      ),
      runProgram(60_000),
    );
    expect(a).toMatchObject({ check: "fuites_fuyant", ran: true });
    const found = a?.ran ? a.observations : [];
    expect(found.map((o) => o.title)).toEqual([
      expect.stringMatching(
        /^Projet fuyant : secret possible \(aws-access-token\) dans app\.js, ligne 1/,
      ),
    ]);
    expect(JSON.stringify(found)).not.toContain(SECRET);
    expect(JSON.stringify(found)).not.toContain(leaky);
    expect(b).toEqual({ check: "fuites_propre", ran: true, observations: [] });
  });

  // Found by this test: outside a repository gitleaks says "nothing found" (code 0).
  it("a folder that is gone, or not a git repository: could not run", async () => {
    const plain = join(BASE, "pas-un-depot");
    mkdirSync(plain);
    const results = await runChecks(
      projectSpecs(
        [
          { name: "parti", path: join(BASE, "absent"), npm: false, secrets: true },
          { name: "simple", path: plain, npm: false, secrets: true },
        ],
        "/nowhere",
      ),
      runProgram(60_000),
    );
    expect(results.map((r) => r.ran)).toEqual([false, false]);
  });
});

describe("npm in a project", () => {
  it("audits the lock file only, in the project's folder; findings named after it", async () => {
    const dir = repo("boutique", { "package-lock.json": "{}\n" });
    const bin = join(BASE, "bin");
    mkdirSync(bin);
    const audit = JSON.stringify({
      vulnerabilities: {
        "left-pad": { via: [{ source: 7, title: "x", severity: "high" }], fixAvailable: true },
      },
    });
    writeFileSync(
      join(bin, "npm"),
      `#!/bin/sh\necho "$PWD $@" > "${bin}/args"\necho '${audit}'\nexit 1\n`,
    );
    chmodSync(join(bin, "npm"), 0o755);
    const [r] = await runChecks(
      projectSpecs([{ name: "boutique", path: dir, npm: true, secrets: false }], bin),
      runProgram(60_000),
    );
    expect(
      execFileSync("/bin/cat", [join(bin, "args")])
        .toString()
        .trim(),
    ).toBe(`${realpathSync(dir)} audit --json --package-lock-only`);
    expect(r).toMatchObject({ check: "npm_boutique", ran: true });
    expect(r?.ran ? r.observations.map((o) => o.target) : []).toEqual(["boutique/left-pad"]);
  });
});

const obs = (type: string, severity: Observation["severity"], n: number): Observation => ({
  type,
  target: `monsite/p${n}`,
  occurrence: String(n),
  severity,
  title: `${type} ${n}`,
});

describe("my projects at the round", () => {
  it("a critical advisory of a project waits for 7:30; a leak speaks at once", async () => {
    const w = world([obs("projet_npm", "critique", 1), obs("projet_fuite", "eleve", 2)]);
    // The day's report has gone at 7:30: a high finding may speak from then on.
    w.at("2026-10-11T07:30:00");
    await runRound(w.deps);
    w.sent.length = 0;
    w.at("2026-10-11T07:45:00");
    expect(await runRound(w.deps)).toMatchObject({ urgent: 1 });
    expect(w.sent.at(-1)?.text).toContain("projet_fuite 2");
    expect(w.sent.at(-1)?.text).not.toContain("projet_npm 1");
    w.at("2026-10-12T07:30:00");
    await runRound(w.deps);
    expect(w.sent.at(-1)?.text).toContain("projet_npm 1");
  });

  it(`the CTO comments the worst ${MAX_COMMENTS} of a message, no more`, async () => {
    const many = [
      ...Array.from({ length: 8 }, (_, i) => obs("projet_npm", "faible", i)),
      obs("projet_npm", "critique", 20),
    ];
    const w = world(many);
    const commented: string[] = [];
    const deps = {
      ...w.deps,
      comment: async (f: StoredFinding) => {
        commented.push(f.title);
        return "Explication.";
      },
    };
    await runRound(deps);
    w.at("2026-10-10T10:15:00");
    await runRound(deps);
    w.at("2026-10-11T07:30:00");
    await runRound(deps);
    expect(commented).toHaveLength(MAX_COMMENTS);
    expect(commented[0]).toBe("projet_npm 20");
  });
});
