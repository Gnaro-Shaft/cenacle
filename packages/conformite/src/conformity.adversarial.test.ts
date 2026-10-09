// The gate (ADR-0022): this repository's registers, cadre, code and
// documentation agree — or every gap is declared, with its reason and date.
// A new table, duration, host, agent or secret family without its line in
// the registers makes `npm run check`, hence the CI, fail here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkConformity } from "./conformity.ts";
import { parseExceptions } from "./exceptions.ts";
import { loadFacts } from "./facts.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");

describe("this repository", () => {
  const facts = loadFacts(ROOT);

  it("the facts are really read (the gate cannot pass by reading nothing)", () => {
    expect(facts.tables.length).toBeGreaterThanOrEqual(6);
    expect(facts.agents).toEqual(expect.arrayContaining(["cto", "iris"]));
    expect(facts.hosts.map((h) => h.host)).toContain("api.telegram.org");
    expect(facts.secretFiles).toContain(".env.sentinel");
    expect(facts.cadres.map((c) => c.name)).toEqual(["cadre.toml", "cadre.local.example.toml"]);
    expect(facts.tempoRetentionHours.length).toBeGreaterThan(0);
  });

  it("registers, cadre, code and documentation agree, or each gap is declared", () => {
    const exceptions = parseExceptions(
      readFileSync(join(ROOT, "docs", "conformite", "exceptions.md"), "utf8"),
    );
    const verdict = checkConformity(facts, exceptions);
    expect(verdict.findings.map((f) => `[${f.check}] ${f.detail}`)).toEqual([]);
  });
});
