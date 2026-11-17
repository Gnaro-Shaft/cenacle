// The CI's audit, minus advisories set aside by hand: an exception excuses
// one advisory, by its GHSA id, until its date, while no fix can be taken
// without a major change. Everything else high or critical fails, and so does
// an output that cannot be read, or an exception that no longer serves.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type AuditException, EXCEPTIONS, judgeAudit } from "./audit-deps.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const ID = "GHSA-fc5q-39xc-vjpf";
const OTHER = "GHSA-2222-3333-4444";
const SET_ASIDE: AuditException[] = [
  { ghsa: ID, packages: ["picomatch"], raison: "pour l'essai", jusqua: "2026-12-17" },
];
const MAJOR_ONLY = { name: "vitest", version: "3.1.4", isSemVerMajor: true };

function advisory(source: number, severity: string, url = `https://github.com/advisories/${ID}`) {
  return { source, name: "picomatch", title: "ReDoS", url, severity, range: "<=4.0.7" };
}
/** An `npm audit --json` output: picomatch with `via`, and a carrier package. */
function report(via: unknown[], fixAvailable: unknown = MAJOR_ONLY): string {
  return JSON.stringify({
    vulnerabilities: {
      picomatch: { name: "picomatch", severity: "high", via, fixAvailable },
      vite: { name: "vite", severity: "high", via: ["picomatch"], fixAvailable: MAJOR_ONLY },
    },
  });
}
const judge = (raw: string, today = "2026-11-17", exceptions = SET_ASIDE) =>
  judgeAudit(raw, exceptions, today);

describe("the dependency audit", () => {
  it("the advisory set aside, no fix, within its date: passes, and says so", () => {
    const v = judge(report([advisory(1, "high")]));
    expect(v.ok).toBe(true);
    expect(v.lines.join("\n")).toMatch(new RegExp(`${ID} \\(picomatch\\) écarté jusqu'au`));
    expect(judge(report([advisory(1, "high")]), "2026-12-17").ok).toBe(true);
  });

  it("the day after its date: fails, to be looked at again", () => {
    const v = judge(report([advisory(1, "high")]), "2026-12-18");
    expect(v.ok).toBe(false);
    expect(v.lines.join("\n")).toMatch(/à revoir/);
  });

  it.each([
    ["npm audit fix would take it", true],
    ["a minor bump of a parent would", { name: "vite", version: "7.9.9", isSemVerMajor: false }],
  ])("a fix exists (%s): fails, to take it", (_what, fix) => {
    const v = judge(report([advisory(1, "high")], fix));
    expect(v.ok).toBe(false);
    expect(v.lines.join("\n")).toMatch(/a désormais un correctif/);
  });

  it.each([
    ["another high advisory", "high", `https://github.com/advisories/${OTHER}`],
    ["another critical advisory", "critical", `https://github.com/advisories/${OTHER}`],
    ["the same id on another site", "high", `https://advisories.example.test/${ID}`],
    ["the same id under a longer path", "high", `https://github.com/advisories/x/${ID}`],
  ])("%s: not excused", (_what, severity, url) => {
    const v = judge(report([advisory(1, "high"), advisory(2, severity, url)]));
    expect(v.ok).toBe(false);
    expect(v.lines.filter((l) => l.startsWith("✗"))).toHaveLength(1);
    expect(v.lines.some((l) => l.startsWith("✔"))).toBe(false);
  });

  it("the same advisory on a package the exception does not name: blocks", () => {
    const raw = JSON.stringify({
      vulnerabilities: {
        picomatch: { severity: "high", via: [advisory(1, "high")], fixAvailable: MAJOR_ONLY },
        "picomatch-runtime": { severity: "high", via: [advisory(1, "high")], fixAvailable: false },
      },
    });
    const v = judge(raw);
    expect(v.ok).toBe(false);
    expect(v.lines.join("\n")).toMatch(/picomatch-runtime/);
  });

  it("each package is judged: a fix on the second one is not hidden by the first", () => {
    const both = [
      { ...SET_ASIDE[0], packages: ["picomatch", "picomatch-bis"] },
    ] as AuditException[];
    const raw = JSON.stringify({
      vulnerabilities: {
        picomatch: { severity: "high", via: [advisory(1, "high")], fixAvailable: MAJOR_ONLY },
        "picomatch-bis": { severity: "high", via: [advisory(1, "high")], fixAvailable: true },
      },
    });
    const v = judge(raw, "2026-11-17", both);
    expect(v.ok).toBe(false);
    expect(v.lines.join("\n")).toMatch(/\(picomatch-bis\) a désormais un correctif/);
  });

  it("a fix of an unexpected shape counts as a fix (fails closed)", () => {
    const odd = { name: "vitest", version: "4.0.0+build.1" };
    expect(judge(report([advisory(1, "high")], odd)).ok).toBe(false);
  });

  it.each([
    ["an old-style name", { JSONStream: { severity: "high", via: [advisory(2, "high", "x")] } }],
    ["a severity npm adds later", { a: { severity: "severe", via: [advisory(2, "severe", "x")] } }],
    ["a via that is not a list", { a: { severity: "high", via: "picomatch" } }],
    ["a via that is null", { a: { severity: "high", via: [null] } }],
    ["an entry that is not an object", { a: "high" }],
  ])("%s: blocks, never skipped", (_what, extra) => {
    const raw = JSON.stringify({
      vulnerabilities: {
        picomatch: { severity: "high", via: [advisory(1, "high")], fixAvailable: MAJOR_ONLY },
        ...extra,
      },
    });
    expect(judge(raw).ok).toBe(false);
  });

  it("no cap: a high advisory after six hundred clean packages still blocks", () => {
    const vulnerabilities: Record<string, unknown> = {
      picomatch: { severity: "high", via: [advisory(1, "high")], fixAvailable: MAJOR_ONLY },
    };
    for (let i = 0; i < 600; i++) {
      vulnerabilities[`p${i}`] = { severity: "low", via: [advisory(i + 10, "low", "x")] };
    }
    vulnerabilities.last = {
      severity: "high",
      via: Array.from({ length: 60 }, (_, i) => advisory(i + 1000, i === 59 ? "high" : "low", "x")),
    };
    expect(judge(JSON.stringify({ vulnerabilities })).ok).toBe(false);
  });

  it("a moderate or low advisory does not block, as before", () => {
    const raw = report([
      advisory(1, "high"),
      advisory(2, "moderate", `https://github.com/advisories/${OTHER}`),
      advisory(3, "low", `https://github.com/advisories/${OTHER}`),
    ]);
    expect(judge(raw).ok).toBe(true);
  });

  it("an exception that no longer serves fails: the list stays true", () => {
    const v = judge(JSON.stringify({ vulnerabilities: {} }));
    expect(v.ok).toBe(false);
    expect(v.lines.join("\n")).toMatch(new RegExp(`${ID} ne sert plus`));
    // Downgraded below high: set aside for nothing.
    expect(judge(report([advisory(1, "moderate")])).ok).toBe(false);
  });

  it("no exception, a clean report: passes", () => {
    expect(judge(JSON.stringify({ vulnerabilities: {} }), "2026-11-17", []).ok).toBe(true);
  });

  it.each([
    ["nothing", ""],
    ["npm's error", '{"error":{"code":"ENOAUDIT","summary":"no"}}'],
    ["text", "npm ERR! audit endpoint returned an error"],
    ["an array", "[]"],
  ])("an unreadable output (%s): fails, nothing judged", (_what, raw) => {
    const v = judge(raw);
    expect(v.ok).toBe(false);
    expect(v.lines.join("\n")).toMatch(/rien n'est jugé/);
  });

  it("a malformed date fails rather than compares as text", () => {
    expect(judge(report([advisory(1, "high")]), "17/11/2026").ok).toBe(false);
    const bad = [{ ...SET_ASIDE[0], jusqua: "2099-1-1" }] as AuditException[];
    expect(judge(report([advisory(1, "high")]), "2026-11-17", bad).ok).toBe(false);
  });
});

describe("the exceptions themselves, and the CI", () => {
  it("each names one GHSA, says why, and ends on a day", () => {
    for (const e of EXCEPTIONS) {
      expect(e.ghsa).toMatch(/^GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}$/);
      expect(e.packages.length).toBeGreaterThan(0);
      expect(e.raison.length).toBeGreaterThan(30);
      expect(e.jusqua).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("the CI audits through this, never npm audit alone", () => {
    const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(ci).toMatch(/run: npm run deps:audit/);
    expect(ci).not.toMatch(/run: npm audit/);
    const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
    expect(scripts["deps:audit"]).toBe("node apps/cli/src/audit-deps.ts");
  });
});
