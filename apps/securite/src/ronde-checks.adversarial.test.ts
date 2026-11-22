// The servers' check (ADR-0040, R4): the verdict of Cénacle's ronde, at its own
// limit, when securite.toml names it — one check, under the id it always had.
// A source that names nothing, a verdict missing, too old or cut short: could
// not run — never a clean bill, never Legion's old verdict in its place. The
// comparison of the two rondes ended with Legion: no result of it, ever.
import { RONDE_VERDICT_PATH } from "@cenacle/securite";
import { describe, expect, it } from "vitest";
import { rondeResults } from "./ronde-checks.ts";

const NOW_S = 1_794_679_266;
const NOW = NOW_S * 1000;
const OLD_LEGION_PATH = `${process.env.HOME ?? ""}/Library/Caches/fr.gnaro.legion.ronde.verdict`;
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
    path === OLD_LEGION_PATH ? legion : path === RONDE_VERDICT_PATH ? cenacle : null;
const run = (legion: string | null, cenacle: string | null, securiteToml: string | null) =>
  rondeResults(files(legion, cenacle), securiteToml, NOW);
const COULD_NOT_RUN = [{ check: "legion_ronde", ran: false }];

describe("the servers' check reads Cénacle's ronde, and that one only", () => {
  it("Cénacle's: its findings, under the same check (open findings stay theirs)", () => {
    const results = run(LEGION, CENACLE, toml("cenacle"));
    expect(results).toHaveLength(1);
    const [servers] = results;
    expect(servers?.check).toBe("legion_ronde");
    expect(servers?.ran && servers.observations.map((o) => o.type)).toEqual(["serveur_services"]);
  });

  it("Cénacle's at 19 minutes still proves", () => {
    expect(run(LEGION, verdict(null, 19), toml("cenacle"))[0]?.ran).toBe(true);
  });

  it.each([
    ["Legion named, its verdict fresh on the Mac", LEGION, CENACLE, toml("legion")],
    ["no [ronde] at all (Legion's by default, before R4)", LEGION, CENACLE, "[serveurs]\n"],
    ["a source securite.toml does not name", LEGION, CENACLE, toml("cenacel")],
    ["securite.toml that does not parse", LEGION, CENACLE, "[ronde"],
    ["securite.toml missing", LEGION, CENACLE, null],
    ["Cénacle's, none written yet — Legion's there", LEGION, null, toml("cenacle")],
    ["Cénacle's, 21 minutes old", LEGION, verdict(null, 21), toml("cenacle")],
    ["Cénacle's, cut short", LEGION, CENACLE.replace("\nfin=1", ""), toml("cenacle")],
  ])("%s: could not run, Legion's never read instead", (_what, legion, cenacle, text) => {
    expect(run(legion, cenacle, text)).toEqual(COULD_NOT_RUN);
  });

  it("Legion's old verdict file is never even opened", () => {
    const opened: string[] = [];
    const read = (path: string) => {
      opened.push(path);
      return path === RONDE_VERDICT_PATH ? CENACLE : LEGION;
    };
    rondeResults(read, toml("cenacle"), NOW);
    rondeResults(read, toml("legion"), NOW);
    expect(opened).toEqual([RONDE_VERDICT_PATH]);
  });

  it("a file that cannot be read (denied, a folder): could not run, nothing thrown", () => {
    const read = (): string | null => {
      throw new Error("EACCES");
    };
    expect(rondeResults(read, toml("cenacle"), NOW)).toEqual(COULD_NOT_RUN);
  });

  it("no comparison of the two rondes, whatever the files", () => {
    for (const text of [toml("cenacle"), toml("legion"), null]) {
      const checks = run(LEGION, CENACLE, text).map((r) => r.check);
      expect(checks).not.toContain("ronde_comparaison");
    }
  });
});
