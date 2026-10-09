// The CTO checks before he is believed (ADR-0017): every ADR, file, command
// and name his answer cites is looked up in the repository by code; an
// invented one is caught and sent back once; a name found only in a private
// or fixture file counts as not found; nothing makes the check run unbounded.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { annotate, answerVerified, checkSummary, NOT_FOUND_MARK } from "./answer.ts";
import { extractClaims, MAX_CLAIMS } from "./claims.ts";
import { buildRepoIndex, type RepoIndex, verifyClaims } from "./verify.ts";

let root = "";
let index: RepoIndex;
const put = (path: string, text: string) => {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), text);
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cto-verify-"));
  const git = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { stdio: "pipe" });
  git("init", "-q");
  put("package.json", JSON.stringify({ scripts: { "mail:sort": "x", iris: "y" } }));
  put("docs/adr/0016-tous-les-dossiers.md", "Les noms de dossiers : `folder_key`.");
  put("packages/mail/src/collect.ts", "export function collectMail() { return mail_locations; }");
  put("fixtures/mails.json", "secretFixtureName");
  put(".env.mail", "CENACLE_MAIL_PASSWORD=onlyInPrivateFile");
  put("cadre.local.toml", "privateTomlKey = 1");
  git("add", "-f", "-A");
  git("-c", "user.email=t@t.test", "-c", "user.name=t", "commit", "-q", "-m", "init");
  index = buildRepoIndex(root);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const check = (answer: string) =>
  Object.fromEntries(
    verifyClaims(extractClaims(answer), index).map((c) => [
      `${c.claim.kind}:${c.claim.value}`,
      c.found,
    ]),
  );

describe("what an answer cites", () => {
  it("ADRs, commands, paths and names", () => {
    const claims = extractClaims(
      "Voir ADR-0016 et ADR 0016, `npm run mail:sort`, npm run iris, `packages/mail/src/collect.ts`, docs/adr/0016-tous-les-dossiers.md, `collectMail()`, `[ouverture]`.",
    );
    expect(claims).toEqual(
      expect.arrayContaining([
        { kind: "adr", value: "0016" },
        { kind: "script", value: "mail:sort" },
        { kind: "script", value: "iris" },
        { kind: "path", value: "packages/mail/src/collect.ts" },
        { kind: "path", value: "docs/adr/0016-tous-les-dossiers.md" },
        { kind: "name", value: "collectMail" },
        { kind: "name", value: "ouverture" },
      ]),
    );
  });

  it("code snippets, numbers and dates are not names", () => {
    expect(extractClaims("`brouillons = 2026-10-18` `2026-10-05` `42` `a`")).toEqual([]);
  });

  it("a huge or hostile answer gives at most MAX_CLAIMS claims, quickly", () => {
    const hostile = Array.from(
      { length: 5000 },
      (_, i) => `\`name${i}\` ADR-${String(i).padStart(4, "0")}`,
    ).join(" ");
    const t = Date.now();
    expect(extractClaims(hostile).length).toBe(MAX_CLAIMS);
    expect(Date.now() - t).toBeLessThan(1000);
    expect(extractClaims(`${"`".repeat(100_000)}x`).length).toBe(0);
  });
});

describe("checked in the repository", () => {
  it("what exists is found", () => {
    expect(
      check(
        "ADR-0016 `npm run mail:sort` `packages/mail/src/collect.ts` `packages/mail` `collectMail()` `mail_locations` `folder_key`",
      ),
    ).toEqual({
      "adr:0016": true,
      "script:mail:sort": true,
      "path:packages/mail/src/collect.ts": true,
      "path:packages/mail": true,
      "name:collectMail": true,
      "name:mail_locations": true,
      "name:folder_key": true,
    });
  });

  it.each([
    ["an invented ADR", "ADR-0099", "adr:0099"],
    ["an invented command", "`npm run mesure:curseurs`", "script:mesure:curseurs"],
    ["an invented file", "`packages/mail/src/auto-heal.ts`", "path:packages/mail/src/auto-heal.ts"],
    ["an invented name", "`selfHealingRebuild()`", "name:selfHealingRebuild"],
    ["a path out of the repository", "`../outside/x.md`", "path:../outside/x.md"],
    ["an absolute path", "`/etc/passwd.md`", "path:/etc/passwd.md"],
    ["a private file named as a path", "`.env.mail`", "name:.env.mail"],
    ["a name only in a fixture", "`secretFixtureName`", "name:secretFixtureName"],
    ["a name only in a private file", "`onlyInPrivateFile`", "name:onlyInPrivateFile"],
    ["a key only in a .local.toml", "`privateTomlKey`", "name:privateTomlKey"],
  ])("%s is not found", (_l, answer, key) => {
    expect(check(answer)[key]).toBe(false);
  });
});

describe("answerVerified", () => {
  it("nothing invented: one draft, shown as is, with its check", async () => {
    const asked: string[] = [];
    let told = 0;
    const a = await answerVerified(
      "Q ?",
      async (p) => {
        asked.push(p);
        return "Voir ADR-0016 et `collectMail()`.";
      },
      index,
      () => told++,
    );
    expect(told).toBe(0);
    expect(asked).toEqual(["Q ?"]);
    expect(a.revised).toBe(false);
    expect(checkSummary(a)).toBe("✔ 2 références vérifiées dans le dépôt");
  });

  it("an invented reference: sent back once with the list, the rewrite is checked again", async () => {
    const asked: string[] = [];
    const told: number[] = [];
    const replies = [
      "Voir ADR-0099 et `selfHealingRebuild()`, et ADR-0016.",
      "Voir ADR-0016 seulement.",
    ];
    const a = await answerVerified(
      "Q ?",
      async (p) => {
        asked.push(p);
        return replies.shift() ?? "";
      },
      index,
      (missing) => told.push(asked.length, missing.length),
    );
    // Told once, after the draft and before the rewrite, with the count only.
    expect(told).toEqual([1, 2]);
    expect(asked).toHaveLength(2);
    expect(asked[1]).toContain("ADR-0099");
    expect(asked[1]).toContain("selfHealingRebuild");
    expect(asked[1]).not.toContain("- ADR-0016");
    // The rewrite answers the person, not the check: no apology, no list of what was removed.
    expect(asked[1]).toMatch(/pas de la personne.*sans nommer les éléments retirés/);
    expect(a).toMatchObject({ text: "Voir ADR-0016 seulement.", revised: true });
    expect(checkSummary(a)).toBe(
      "✔ 1 référence vérifiée dans le dépôt · premier jet corrigé (2 éléments introuvables)",
    );
  });

  it("a rewrite that still cites the invented reference: shown, but flagged — never hidden", async () => {
    const a = await answerVerified("Q ?", async () => "Voir ADR-0099.", index);
    expect(a.revised).toBe(true);
    expect(checkSummary(a)).toContain("⚠ 1 introuvable : ADR-0099");
  });

  it("the model failing: the error reaches the caller, nothing is shown as checked", async () => {
    await expect(
      answerVerified(
        "Q ?",
        async () => {
          throw new Error("model down");
        },
        index,
      ),
    ).rejects.toThrow("model down");
  });
});

describe("annotate mode (J3, ADR-0021): the code marks, the model is asked once", () => {
  it("one model call; each missing reference marked where it stands, the rest untouched", async () => {
    const asked: string[] = [];
    const a = await answerVerified(
      "Q ?",
      async (p) => {
        asked.push(p);
        return "Voir ADR-0016, ADR-0099 et `selfHealingRebuild()`, puis `npm run nope`.";
      },
      index,
      undefined,
      "annotate",
    );
    expect(asked).toHaveLength(1);
    expect(a.revised).toBe(false);
    expect(a.text).toContain(`ADR-0099${NOT_FOUND_MARK}`);
    expect(a.text).toContain(`\`npm run nope\`${NOT_FOUND_MARK}`);
    expect(a.text).not.toContain(`ADR-0016${NOT_FOUND_MARK}`);
    expect(checkSummary(a)).toMatch(/⚠ \d introuvables? :.*ADR-0099/);
  });

  it("at most three marks per reference, never twice on the same spot", () => {
    const claim = { kind: "path" as const, value: "apps/x.ts" };
    const text = Array.from({ length: 5 }, () => "`apps/x.ts`").join(" ");
    const once = annotate(text, [claim]);
    expect(once.split(NOT_FOUND_MARK)).toHaveLength(4);
    expect(annotate(once, [claim])).toBe(once);
  });

  it("a reference absent from the text changes nothing", () => {
    expect(annotate("rien", [{ kind: "adr", value: "0099" }])).toBe("rien");
  });
});
