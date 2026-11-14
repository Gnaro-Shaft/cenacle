// Finding n° 242 (14/11): a major version Dependabot is told to leave alone
// is a decision, not a delay. npm_outdated stays silent on it — and on
// nothing else: any form it does not understand holds nothing back.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { heldBackRules, isHeldBack } from "./held-back.ts";
import { parseNpmOutdated } from "./parse-npm.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const file = (ignore: string, ecosystem = "npm") =>
  `version: 2\nupdates:\n  - package-ecosystem: ${ecosystem}\n    directory: /\n    ignore:\n${ignore}\n    groups:\n      patches:\n        update-types:\n          - patch\n`;
const rule = (name: string, versions: string, extra = "") =>
  `      - dependency-name: "${name}"\n        versions: [${versions}]\n${extra}`;
const outdated = (pkg: string, current: string, latest: string) =>
  JSON.stringify({ [pkg]: { current, latest } });

describe("the rules of dependabot.yml", () => {
  it("this repository's: the five OpenTelemetry packages, with their bounds", () => {
    const rules = heldBackRules(readFileSync(join(ROOT, ".github", "dependabot.yml"), "utf8"));
    expect(rules).toContainEqual({ name: "@opentelemetry/resources", from: [3, 0, 0] });
    expect(rules).toContainEqual({ name: "@opentelemetry/api", from: [1, 10, 0] });
    expect(rules).toHaveLength(5);
  });

  it("a rule of another ecosystem holds back nothing for npm", () => {
    expect(heldBackRules(file(rule("actions/checkout", '">=5.0.0"'), "github-actions"))).toEqual(
      [],
    );
  });

  it.each([
    ["a range", '">=3.0.0, <4"'],
    ["two bounds", '">=3.0.0", ">=4.0.0"'],
    ["an upper bound", '"<3.0.0"'],
    ["a wildcard", '"3.x"'],
    ["no quotes", ">=3.0.0"],
    ["an incomplete version", '">=3"'],
  ])("a form it does not understand (%s) holds nothing back", (_what, versions) => {
    expect(heldBackRules(file(rule("hono", versions)))).toEqual([]);
  });

  it("update-types beside versions holds back less than every version: not taken", () => {
    const text = file(
      rule("hono", '">=5.0.0"', '        update-types: ["version-update:semver-major"]\n'),
    );
    expect(heldBackRules(text)).toEqual([]);
  });

  it("a name npm would not accept is not taken", () => {
    expect(heldBackRules(file(rule("../../etc", '">=1.0.0"')))).toEqual([]);
  });

  it("the ignore list ends where the file says: a later key's lines are not rules", () => {
    const text = `${file(rule("hono", '">=5.0.0"'))}    allow:\n      - dependency-name: "vite"\n        versions: [">=9.0.0"]\n`;
    expect(heldBackRules(text)).toEqual([{ name: "hono", from: [5, 0, 0] }]);
  });

  it("a broken or empty file holds nothing back", () => {
    for (const text of ["", "not: [yaml", "\u0000\u0001", "updates:\n  - ignore:\n"]) {
      expect(heldBackRules(text)).toEqual([]);
    }
  });
});

describe("npm_outdated with the rules", () => {
  const rules = heldBackRules(file(rule("@opentelemetry/resources", '">=3.0.0"')));
  const held = (pkg: string, latest: string) => isHeldBack(rules, pkg, latest);

  it("n° 242: resources 2.12.1 → 3.1.1 is held back on purpose: silent", () => {
    expect(parseNpmOutdated(outdated("@opentelemetry/resources", "2.12.1", "3.1.1"), held)).toEqual(
      [],
    );
    // Without the rules, the same output is still a finding.
    expect(parseNpmOutdated(outdated("@opentelemetry/resources", "2.12.1", "3.1.1"))).toHaveLength(
      1,
    );
  });

  it("a neighbouring name is not held back", () => {
    expect(
      parseNpmOutdated(outdated("@opentelemetry/resources-x", "2.0.0", "3.0.0"), held),
    ).toHaveLength(1);
    expect(parseNpmOutdated(outdated("@opentelemetry/core", "2.0.0", "3.0.0"), held)).toHaveLength(
      1,
    );
  });

  it("the bound is compared as numbers, not as text", () => {
    const api = heldBackRules(file(rule("@opentelemetry/api", '">=1.10.0"')));
    expect(isHeldBack(api, "@opentelemetry/api", "1.9.9")).toBe(false);
    expect(isHeldBack(api, "@opentelemetry/api", "1.10.0")).toBe(true);
    expect(isHeldBack(api, "@opentelemetry/api", "1.10.0-rc.1")).toBe(true);
    expect(isHeldBack(api, "@opentelemetry/api", "2.0.0")).toBe(true);
    expect(isHeldBack(api, "@opentelemetry/api", "not-a-version")).toBe(false);
  });
});
