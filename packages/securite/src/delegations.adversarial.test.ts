// Delegations and the trust record (J6d): securite.toml is read strictly — an
// unknown action, merging, a threshold of 0, a grant in the future, an
// unknown key are refused; a delegation is proposable only past its threshold
// with no failure, granted only by a date, suspended by a failure since that
// date; the PR buttons and views are read strictly.
import { describe, expect, it } from "vitest";
import { parsePrPressed, prKeyboard } from "./buttons.ts";
import {
  DelegationConfigError,
  delegableFix,
  delegationState,
  parseDelegations,
} from "./delegations.ts";
import { parsePrView } from "./pr-status.ts";

const TODAY = "2026-10-11";
const ok = '[[delegation]]\naction = "preparer_pr_npm"\nseuil = 5\n';
const trust = (over = {}) => ({
  prepared: 0,
  mergedClean: 0,
  mergedEdited: 0,
  closed: 0,
  ciFailed: 0,
  ...over,
});

describe("securite.toml", () => {
  it("reads a delegation, granted or not", () => {
    expect(parseDelegations(ok, TODAY)).toEqual([
      { action: "preparer_pr_npm", seuil: 5, accordeeLe: null },
    ]);
    expect(parseDelegations(`${ok}accordee_le = 2026-10-01\n`, TODAY)[0]?.accordeeLe).toBe(
      "2026-10-01",
    );
    expect(parseDelegations("", TODAY)).toEqual([]);
  });

  it.each([
    ["merging, never delegable", '[[delegation]]\naction = "fusionner"\nseuil = 5\n'],
    ["an unknown action", '[[delegation]]\naction = "tout_faire"\nseuil = 5\n'],
    ["a threshold of 0", '[[delegation]]\naction = "preparer_pr_npm"\nseuil = 0\n'],
    ["a fractional threshold", '[[delegation]]\naction = "preparer_pr_npm"\nseuil = 2.5\n'],
    ["a grant in the future", `${ok}accordee_le = 2026-10-12\n`],
    ["a grant that is no date", `${ok}accordee_le = "bientot"\n`],
    ["an unknown key", `${ok}fusion = true\n`],
    ["an unknown section", `${ok}[autre]\nx = 1\n`],
    ["the same action twice", ok + ok],
  ])("refuses %s", (_, source) => {
    expect(() => parseDelegations(source, TODAY)).toThrow(DelegationConfigError);
  });
});

describe("a delegation's state", () => {
  const d = { action: "preparer_pr_npm" as const, seuil: 5, accordeeLe: null };

  it("learning until the threshold; proposable at it, with no failure at all", () => {
    expect(delegationState(d, trust({ mergedClean: 4 }), null)).toBe("apprentissage");
    expect(delegationState(d, trust({ mergedClean: 5 }), null)).toBe("proposable");
    expect(delegationState(d, trust({ mergedClean: 9, closed: 1 }), null)).toBe("apprentissage");
    expect(delegationState(d, trust({ mergedClean: 9, mergedEdited: 1 }), null)).toBe(
      "apprentissage",
    );
    expect(delegationState(d, trust({ mergedClean: 9, ciFailed: 1 }), null)).toBe("apprentissage");
  });

  it("granted only by a date; suspended since it; a newer grant restores it", () => {
    const granted = { ...d, accordeeLe: "2026-10-05" };
    expect(delegationState(granted, trust(), null)).toBe("accordee");
    expect(delegationState(granted, trust(), "2026-10-04")).toBe("accordee");
    expect(delegationState(granted, trust(), "2026-10-05")).toBe("suspendue");
    expect(delegationState(granted, trust(), "2026-10-09")).toBe("suspendue");
    expect(delegationState({ ...d, accordeeLe: "2026-10-10" }, trust(), "2026-10-09")).toBe(
      "accordee",
    );
  });

  it("a major version change is never delegated", () => {
    expect(delegableFix({ fixMajor: "0" })).toBe(true);
    expect(delegableFix({})).toBe(true);
    expect(delegableFix({ fixMajor: "1" })).toBe(false);
  });
});

describe("the PR buttons and views", () => {
  const TOKEN = ["01234567", "89abcdef"].join("");

  it("✅ and ❌ read back; anything else ignored", () => {
    const [[merge, close] = []] = prKeyboard(7, TOKEN);
    expect(parsePrPressed(merge?.data)).toEqual({ id: 7, action: "merge", token: TOKEN });
    expect(parsePrPressed(close?.data)).toEqual({ id: 7, action: "close", token: TOKEN });
    for (const bad of [
      `s:7:m:${TOKEN}`,
      `p:7:x:${TOKEN}`,
      `p:0:m:${TOKEN}`,
      "p:7:m:0123",
      `p:7:m:${TOKEN}!`,
    ]) {
      expect(parsePrPressed(bad)).toBeNull();
    }
  });

  it("a view: head commit, base, files, commits — or nothing usable", () => {
    const v = parsePrView(
      JSON.stringify({
        state: "OPEN",
        statusCheckRollup: [{ conclusion: "SUCCESS" }],
        headRefOid: "c".repeat(40),
        baseRefName: "main",
        files: [{ path: "package-lock.json" }, { path: 7 }],
        commits: [{}, {}],
      }),
    );
    expect(v).toEqual({
      status: "ci_passed",
      headSha: "c".repeat(40),
      base: "main",
      files: ["package-lock.json"],
      commits: 2,
    });
    expect(parsePrView('{"state":"OPEN","headRefOid":"short"}').headSha).toBeNull();
    expect(parsePrView("nope").status).toBe("unknown");
  });
});
