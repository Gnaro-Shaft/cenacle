// The servers' checks (ADR-0040, R3): the verdict of the source securite.toml
// names, at that source's own limit; both rondes compared. A source that names
// nothing, a verdict missing or too old: could not run — never a clean bill,
// never the other ronde's verdict in its place.
import { LEGION_VERDICT_PATH, RONDE_VERDICT_PATH } from "@cenacle/securite";
import { describe, expect, it } from "vitest";
import { rondeResults } from "./ronde-checks.ts";

const NOW_S = 1_794_679_266;
const NOW = NOW_S * 1000;
const verdict = (motif: string | null, minutes = 1) =>
  [
    `etat=${motif === null ? "SAIN" : "SOUFFRANT"}`,
    `instant=${NOW_S - minutes * 60}`,
    "hotes=1",
    `alpha.etat=${motif === null ? "SAIN" : "SOUFFRANT"}`,
    ...(motif === null ? [] : [`alpha.motif1=${motif}`]),
    "fin=1",
  ].join("\n");
const LEGION = verdict("redemarrage requis — un noyau corrige mais non charge");
const CENACLE = verdict("3 service(s) tournent sur une bibliotheque remplacee");
const toml = (source: string) => `[ronde]\nsource = "${source}"\n`;

const files =
  (legion: string | null, cenacle: string | null) =>
  (path: string): string | null =>
    path === LEGION_VERDICT_PATH ? legion : path === RONDE_VERDICT_PATH ? cenacle : null;
const run = (legion: string | null, cenacle: string | null, securiteToml: string) =>
  rondeResults(files(legion, cenacle), securiteToml, NOW);
const types = (r: ReturnType<typeof run>[number]) =>
  r.ran ? r.observations.map((o) => o.type) : "could not run";

describe("the servers' check reads the source chosen, and that one only", () => {
  it("Legion's: its findings", () => {
    const [servers] = run(LEGION, CENACLE, toml("legion"));
    expect(servers?.check).toBe("legion_ronde");
    expect(servers && types(servers)).toEqual(["serveur_redemarrage"]);
  });

  it("Cénacle's: its findings, under the same check (open findings stay theirs)", () => {
    const [servers] = run(LEGION, CENACLE, toml("cenacle"));
    expect(servers?.check).toBe("legion_ronde");
    expect(servers && types(servers)).toEqual(["serveur_services"]);
  });

  it("no [ronde] at all: Legion's, as before", () => {
    const [servers] = run(LEGION, CENACLE, "[serveurs]\nactif = true\n");
    expect(servers && types(servers)).toEqual(["serveur_redemarrage"]);
  });

  it.each([
    ["a source securite.toml does not name", LEGION, CENACLE, toml("cenacel")],
    ["securite.toml that does not parse", LEGION, CENACLE, "[ronde"],
    ["Cénacle's chosen, and none written yet", LEGION, null, toml("cenacle")],
    ["Cénacle's chosen, 21 minutes old", LEGION, verdict(null, 21), toml("cenacle")],
    ["Legion's chosen, 46 minutes old", verdict(null, 46), CENACLE, toml("legion")],
    ["Legion's chosen, cut short", LEGION.replace("\nfin=1", ""), CENACLE, toml("legion")],
  ])("%s: could not run, the other ronde never read instead", (_what, legion, cenacle, text) => {
    const [servers] = run(legion, cenacle, text);
    expect(servers).toEqual({ check: "legion_ronde", ran: false });
  });

  it("Legion's chosen at 40 minutes still proves (its own limit), Cénacle's at 19 too", () => {
    expect(run(verdict(null, 40), CENACLE, toml("legion"))[0]?.ran).toBe(true);
    expect(run(LEGION, verdict(null, 19), toml("cenacle"))[0]?.ran).toBe(true);
  });

  it("a file that cannot be read (denied, a folder): could not run, nothing thrown", () => {
    const read = (): string | null => {
      throw new Error("EACCES");
    };
    expect(rondeResults(read, toml("legion"), NOW)).toEqual([
      { check: "legion_ronde", ran: false },
      { check: "ronde_comparaison", ran: false },
    ]);
  });
});

describe("both rondes compared, whatever the source", () => {
  it("each difference a finding", () => {
    const [, compared] = run(LEGION, CENACLE, toml("legion"));
    expect(compared?.check).toBe("ronde_comparaison");
    expect(compared && types(compared)).toEqual(["ronde_ecart", "ronde_ecart"]);
  });

  it("compared even when securite.toml names no source", () => {
    expect(run(LEGION, CENACLE, toml("cenacel"))[1]?.ran).toBe(true);
  });

  it.each([
    ["Cénacle's missing", LEGION, null],
    ["Legion's missing", null, CENACLE],
    ["Cénacle's too old", LEGION, verdict(null, 21)],
  ])("%s: could not run, never « no difference »", (_what, legion, cenacle) => {
    expect(run(legion, cenacle, toml("legion"))[1]).toEqual({
      check: "ronde_comparaison",
      ran: false,
    });
  });
});
