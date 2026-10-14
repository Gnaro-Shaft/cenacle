// The operator, blocked or silent, as a finding (2026-10-14): read with the
// switch of securite.toml, always "ran"; through the usual lifecycle it waits
// ten minutes before it counts, and closes as resolved once the state says ok.
// The security agent never reads serveurs.local.toml itself.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ActiveFinding, reconcile } from "@cenacle/securite";
import { describe, expect, it } from "vitest";
import { OPERATOR_CHECK, operatorResult } from "./checks.ts";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const MIN = 60_000;
const ON = "[serveurs]\nactif = true\n";
const state = (config: string, at = NOW) =>
  `instant=${Math.floor(at / 1000)}\nconfig=${config}\nfin=1\n`;

const blocked = (status: ActiveFinding["status"]): ActiveFinding => ({
  id: 1,
  check: OPERATOR_CHECK,
  type: "operateur_config",
  target: "serveurs.local.toml",
  occurrence: "cles",
  status,
  firstSeen: new Date(NOW),
});

describe("the operator check", () => {
  it("switch on: a blocked list is one finding; ok is none", () => {
    expect(operatorResult(state("cles"), ON, NOW)).toMatchObject({
      check: OPERATOR_CHECK,
      ran: true,
      observations: [{ type: "operateur_config", occurrence: "cles" }],
    });
    expect(operatorResult(state("ok"), ON, NOW)).toEqual({
      check: OPERATOR_CHECK,
      ran: true,
      observations: [],
    });
  });

  it("switch off, absent, or anything but exactly true: nothing, even with no state", () => {
    for (const toml of ["", "[serveurs]\nactif = false\n", '[serveurs]\nactif = "true"\n']) {
      expect(operatorResult(null, toml, NOW)).toEqual({
        check: OPERATOR_CHECK,
        ran: true,
        observations: [],
      });
    }
  });

  it("switch on and no state: the operator is silent", () => {
    expect(operatorResult(null, ON, NOW)).toMatchObject({
      observations: [{ type: "operateur_silencieux", severity: "eleve" }],
    });
  });

  it("through the lifecycle: a candidate first, counted after ten minutes, resolved once ok", () => {
    const first = reconcile([], [operatorResult(state("cles"), ON, NOW)], new Date(NOW));
    expect(first.insert.map((o) => o.type)).toEqual(["operateur_config"]);
    const soon = NOW + 5 * MIN;
    const early = reconcile(
      [blocked("candidat")],
      [operatorResult(state("cles", soon), ON, soon)],
      new Date(soon),
    );
    expect(early.promote).toEqual([]);
    const later = NOW + 11 * MIN;
    const counted = reconcile(
      [blocked("candidat")],
      [operatorResult(state("cles", later), ON, later)],
      new Date(later),
    );
    expect(counted.promote.map((p) => p.id)).toEqual([1]);
    const fixed = NOW + 20 * MIN;
    const after = reconcile(
      [blocked("ouvert")],
      [operatorResult(state("ok", fixed), ON, fixed)],
      new Date(fixed),
    );
    expect(after.resolve).toEqual([1]);
  });

  it("every round adds the check, with the state file and the switch", () => {
    const main = readFileSync(join(import.meta.dirname, "main.ts"), "utf8");
    expect(main).toContain("readFileSync(OPERATOR_STATE_PATH");
    expect(main).toContain(
      'operatorResult(state, readIfExists(join(ROOT, "securite.toml")), Date.now())',
    );
  });

  it("the security agent's code never names serveurs.local.toml as a file to read", () => {
    for (const file of ["checks.ts", "main.ts"]) {
      const text = readFileSync(join(import.meta.dirname, file), "utf8");
      expect(text, file).not.toMatch(/serveurs\.local\.toml["'`]\)/);
    }
  });
});
