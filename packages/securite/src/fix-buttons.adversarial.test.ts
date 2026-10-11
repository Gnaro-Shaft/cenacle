// J6c: 🔧 appears only under a finding the catalogue can fix without
// privilege (a dependency with a published version); its button is read like
// the others; and the state of a PR is read strictly.
import { describe, expect, it } from "vitest";
import { keyboard, parsePressed } from "./buttons.ts";
import { preparedFix } from "./catalogue.ts";
import { parsePrStatus } from "./pr-status.ts";

const TOKEN = ["01234567", "89abcdef"].join("");

describe("🔧 prepare the PR", () => {
  it("only under a fixable finding, read back as 'fix'", () => {
    const [plain, fixable] = keyboard([
      { id: 1, token: TOKEN },
      { id: 2, token: TOKEN, fixable: true },
    ]);
    expect(plain).toHaveLength(3);
    expect(fixable).toHaveLength(4);
    expect(parsePressed(fixable?.[3]?.data)).toEqual({ id: 2, action: "fix", token: TOKEN });
  });

  it("fixable: a dependency with a checked name and version — nothing else", () => {
    const npm = { type: "npm_advisory", target: "p", occurrence: "1" };
    expect(preparedFix(npm, { fixName: "left-pad", fixVersion: "1.3.1" })).toEqual({
      name: "left-pad",
      version: "1.3.1",
    });
    expect(preparedFix(npm, { auditFix: "1" })).toBeNull();
    expect(preparedFix(npm, { fixName: "x; rm", fixVersion: "1.0.0" })).toBeNull();
    expect(preparedFix(npm, { fixName: "x", fixVersion: "latest" })).toBeNull();
    for (const type of [
      "firewall_off",
      "software_update",
      "serveur_maj_securite",
      "tailscale_outdated",
    ]) {
      expect(
        preparedFix({ type, target: "t", occurrence: "o" }, { fixName: "x", fixVersion: "1.0.0" }),
      ).toBeNull();
    }
  });
});

describe("the state of a PR", () => {
  const view = (state: string, checks: object[] = []) =>
    JSON.stringify({ state, statusCheckRollup: checks });
  it.each([
    [view("MERGED"), "merged"],
    [view("CLOSED"), "closed"],
    [view("OPEN", [{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }]), "ci_failed"],
    [view("OPEN", [{ conclusion: "SUCCESS" }, { conclusion: "SKIPPED" }]), "ci_passed"],
    [view("OPEN", [{ status: "IN_PROGRESS" }]), "pending"],
    [view("OPEN"), "pending"],
    [view("DRAFTY"), "unknown"],
    ["not json", "unknown"],
    ["null", "unknown"],
  ])("%s → %s", (raw, expected) => {
    expect(parsePrStatus(raw)).toBe(expected);
  });
});
