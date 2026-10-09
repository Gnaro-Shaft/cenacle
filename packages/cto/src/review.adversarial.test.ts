// The review of a branch and the check of `path:line` (ADR-0021): a branch
// name can never be an option or a range; the code computes the diff and
// keeps private or secret-looking files out of it; a cited line must exist in
// the code the answer was written from — never anywhere else.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractClaims } from "./claims.ts";
import { gitView } from "./repo-view.ts";
import { branchTarget, MAX_DIFF, rangeTarget, reviewPrompt, validBranch } from "./review.ts";
import { buildRepoIndex, verifyClaims } from "./verify.ts";

// Fake credentials, built by pieces: no secret signature appears in this source.
const FAKE_PASSWORD_LINE = ["CENACLE_MAIL_PASS", "WORD", "=ne-jamais-montrer"].join("");
const FAKE_TOKEN = ["sk", "-test-", "ABCDEFGHIJKLMNOPQRSTUVWX"].join("");

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

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cto-review-"));
  git("init", "-q", "-b", "main");
  put("package.json", '{"scripts":{}}');
  put(
    "src/service.ts",
    Array.from({ length: 50 }, (_, i) => `export const s${i} = ${i};`).join("\n"),
  );
  put("lib/service.ts", "export const autre = 1;");
  put("src/unique.ts", "export const u = 1;\nexport const v = 2;\n");
  commit("init");
  git("checkout", "-q", "-b", "travail");
  put("src/unique.ts", "export const u = 1;\nexport const v = 3; // changé\n");
  put(".env.mail", FAKE_PASSWORD_LINE);
  put("src/fuite.ts", `const k = '${FAKE_TOKEN}';`);
  put("src/gros.ts", "y".repeat(MAX_DIFF + 500));
  commit("travail");
  git("checkout", "-q", "-b", "vide", "main");
  git("checkout", "-q", "main");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("validBranch", () => {
  it.each(["--output=/tmp/x", "-p", "main..evil", "a b", "x;rm -rf ~", "../x", "x.lock", "", 42])(
    "refuses %j",
    (name) => {
      expect(() => validBranch(name)).toThrow(/refusé/);
    },
  );
  it("accepts an ordinary branch name", () => {
    expect(validBranch("cto-j3")).toBe("cto-j3");
    expect(validBranch("feat/relecture.2")).toBe("feat/relecture.2");
  });
});

describe("the diff, computed by code", () => {
  it("a branch against its merge base: private and secret-looking files are withheld", () => {
    const t = branchTarget(root, "travail");
    expect(t.files).toEqual(expect.arrayContaining(["src/unique.ts", "src/gros.ts"]));
    expect(t.withheld).toEqual(expect.arrayContaining([".env.mail", "src/fuite.ts"]));
    expect(t.diff).not.toContain("ne-jamais-montrer");
    expect(t.diff).not.toContain(FAKE_TOKEN);
    expect(t.diff).toContain("// changé");
  });

  it("a huge file never hides a small change: it becomes one line, and the prompt says so", () => {
    const t = branchTarget(root, "travail");
    expect(t.truncated).toBe(true);
    expect(t.diff.length).toBeLessThanOrEqual(MAX_DIFF + 200);
    // The huge file is a line; the small change behind it is shown whole.
    expect(t.diff).toMatch(/src\/gros\.ts\n\(diff trop long/);
    expect(t.diff).toContain("// changé");
    expect(reviewPrompt(t)).toMatch(/lis le reste avec tes outils/);
    expect(reviewPrompt(t)).toMatch(/Écartés du diff .* : 2/);
  });

  it.each([
    ["an unknown branch", "inconnue"],
    ["a branch with nothing to review", "vide"],
    ["an option disguised as a branch", "--all"],
  ])("%s: an error, never an empty review", (_, name) => {
    expect(() => branchTarget(root, name)).toThrow();
  });

  it("an unknown revision in a range: an error", () => {
    expect(() => rangeTarget(root, "main", "deadbeef", "x")).toThrow(/révision inconnue/);
  });
});

describe("path:line, checked in the code the answer was written from", () => {
  const index = () => ({ ...buildRepoIndex(root), view: gitView(root, "travail") });

  it("extracts lines from backticks and from bare paths", () => {
    const claims = extractClaims(
      "Voir `src/service.ts:12-14`, `unique.ts:2` et packages/x/src/y.ts:7 ; aussi `.env:1`.",
    );
    expect(claims).toEqual(
      expect.arrayContaining([
        { kind: "line", value: "src/service.ts:12-14" },
        { kind: "line", value: "unique.ts:2" },
        { kind: "line", value: "packages/x/src/y.ts:7" },
      ]),
    );
    expect(claims.some((c) => c.kind === "line" && c.value.startsWith(".env"))).toBe(false);
    // A chat command is a name, never an absolute path.
    expect(extractClaims("Envoie `/stop`.")).toEqual([{ kind: "name", value: "/stop" }]);
  });

  it.each([
    ["src/service.ts:12-14", true],
    ["src/service.ts:50", true],
    ["src/service.ts:51", false],
    ["src/service.ts:14-12", false],
    ["src/service.ts:0", false],
    ["unique.ts:2", true],
    ["service.ts:3", false],
    ["service.ts:1", false],
    ["src/inconnu.ts:1", false],
    [".env.mail:1", false],
    ["src/fuite.ts:1", false],
  ])("%s → found %s", (value, found) => {
    expect(verifyClaims([{ kind: "line", value }], index())[0]?.found).toBe(found);
  });

  it("without a view of the code, a line is never taken as found", () => {
    expect(
      verifyClaims([{ kind: "line", value: "src/service.ts:1" }], buildRepoIndex(root))[0]?.found,
    ).toBe(false);
  });
});
