// The compliance checks (ADR-0022), on synthetic facts: every kind of gap is
// caught — one day off, a table without purge, a purge that does not purge,
// a host, an agent or a secret family missing, an ADR that does not exist —
// a malformed register fails loudly, and exceptions need a reason and a date.
import { describe, expect, it } from "vitest";
import type { Facts } from "./checks.ts";
import { checkConformity } from "./conformity.ts";
import { applyExceptions, parseExceptions } from "./exceptions.ts";

const REGISTER = `
| # | Traitement | Conservation |
|---|---|---|
| T-01 | Relève | **90 jours** (\`memoire_jours\`) après l'arrivée |
| T-05 | Journal | **180 jours** (\`journal_jours\`) (C1) |
| T-06 | Traces | **7 jours** (\`deploy/observability/tempo.yaml\`) |

| Service | Usage |
|---|---|
| **Telegram** (\`api.telegram.org\`) | Compteurs |

| Table | Données | Purge |
|---|---|---|
| \`events\` | Faits | \`sql/purges.sql\`, après \`journal_jours\` |
| \`notes\` | Rien de personnel | aucune donnée personnelle : des compteurs agrégés, sans identifiant |
`;
const IA = `
| # | Fonctionnalité |
|---|---|
| IA-01 | Rangement par Iris (ADR-0007) |
| IA-05 | Le CTO répond (ADR-0017) |
`;
const SECRETS = `
| Fichier | Contient |
|---|---|
| \`.env\` | Rien de secret |
| \`.env.mail\` | La boîte |
`;
const FILES: Record<string, string> = { "sql/purges.sql": "DELETE FROM events WHERE x" };

function facts(over: Partial<Facts> = {}): Facts {
  return {
    register: REGISTER,
    registerIa: IA,
    secretsDoc: SECRETS,
    cadres: [{ name: "cadre.toml", conservation: { memoire_jours: 90, journal_jours: 180 } }],
    tempoRetentionHours: [168, 168],
    tables: ["events", "notes"],
    file: (p) => FILES[p] ?? null,
    hosts: [{ host: "api.telegram.org", path: "apps/telegram/src/api.ts" }],
    agents: ["iris", "cto"],
    secretFiles: [".env.mail"],
    adrs: new Set(["0007", "0017"]),
    missingReferences: () => [],
    docs: [],
    ...over,
  };
}
const gaps = (f: Facts) => checkConformity(f).findings.map((g) => `${g.check}:${g.subject}`);
const cadre = (conservation: Record<string, number>) => [{ name: "c", conservation }];

describe("the compliance checks", () => {
  it("a coherent set of facts: no gap", () => {
    expect(checkConformity(facts()).findings).toEqual([]);
  });

  it("durations: one day off, a key missing from a cadre, a key cited nowhere, tempo off", () => {
    expect(gaps(facts({ cadres: cadre({ memoire_jours: 89, journal_jours: 180 }) }))).toEqual([
      "durées:memoire_jours",
    ]);
    expect(gaps(facts({ cadres: cadre({ journal_jours: 180 }) }))).toEqual([
      "durées:memoire_jours",
    ]);
    expect(
      gaps(
        facts({
          cadres: cadre({ memoire_jours: 90, journal_jours: 180, propositions_jours: 90 }),
        }),
      ),
    ).toEqual(["durées:propositions_jours"]);
    expect(gaps(facts({ tempoRetentionHours: [168, 336] }))).toEqual(["durées:tempo"]);
    expect(gaps(facts({ tempoRetentionHours: [] }))).toEqual(["durées:tempo"]);
  });

  it("tables: undeclared, declared but absent, a purge file that does not purge or does not exist", () => {
    expect(gaps(facts({ tables: ["events", "notes", "secrets_nouveaux"] }))).toEqual([
      "tables:secrets_nouveaux",
    ]);
    expect(gaps(facts({ tables: ["events"] }))).toEqual(["tables:notes"]);
    expect(gaps(facts({ file: () => "SELECT * FROM events" }))).toEqual(["tables:events"]);
    expect(gaps(facts({ file: () => null }))).toEqual(["tables:events"]);
  });

  it("tables: « aucune donnée personnelle » needs its reason", () => {
    const register = REGISTER.replace(
      "aucune donnée personnelle : des compteurs agrégés, sans identifiant",
      "aucune donnée personnelle",
    );
    expect(gaps(facts({ register }))).toEqual(["tables:notes"]);
  });

  it("services: a host the code contacts, absent from the third parties", () => {
    expect(gaps(facts({ hosts: [{ host: "api.ailleurs.io", path: "apps/x/src/y.ts" }] }))).toEqual([
      "services:api.ailleurs.io",
    ]);
  });

  it("AI: an agent the register does not name, a line without ADR, an ADR that does not exist", () => {
    expect(gaps(facts({ agents: ["iris", "cto", "veille"] }))).toEqual(["ia:veille"]);
    expect(gaps(facts({ registerIa: IA.replace(" (ADR-0007)", "") }))).toEqual(["ia:IA-01"]);
    expect(gaps(facts({ adrs: new Set(["0007"]) }))).toEqual(["ia:IA-05"]);
  });

  it("secrets: a family of the code undocumented, a documented family the code does not know", () => {
    expect(gaps(facts({ secretFiles: [".env.mail", ".env.sentinel"] }))).toEqual([
      "secrets:.env.sentinel",
    ]);
    expect(gaps(facts({ secretsDoc: `${SECRETS}| \`.env.vieux\` | Ancien |\n` }))).toEqual([
      "secrets:.env.vieux",
    ]);
  });

  it("references: what a compliance document cites and cannot be found", () => {
    const f = facts({
      docs: [{ path: "docs/conformite/x.md", text: "voir ADR-0099" }],
      missingReferences: () => ["ADR-0099"],
    });
    expect(gaps(f)).toEqual(["références:docs/conformite/x.md → ADR-0099"]);
  });

  it("a malformed register fails loudly, never passes silently", () => {
    const register = REGISTER.replace("| T-01 | Relève |", "| T-01 | Relève | en trop |");
    expect(gaps(facts({ register }))).toContain("format:checkDurations");
    expect(gaps(facts({ register: "pas de tableau du tout" }))).toEqual(
      expect.arrayContaining([
        "format:checkDurations",
        "format:checkTables",
        "format:checkServices",
      ]),
    );
  });
});

describe("exceptions", () => {
  const found = [{ check: "secrets" as const, subject: ".env.sentinel", detail: "absente" }];
  const REASON = "documentée à la phase 7, quand la sentinelle change";
  const file = (reason: string, date: string) =>
    `| Contrôle | Sujet | Raison | Date |\n|---|---|---|---|\n| secrets | \`.env.sentinel\` | ${reason} | ${date} |\n`;

  it("a valid exception excuses its gap, and only it", () => {
    const v = applyExceptions(found, parseExceptions(file(REASON, "2026-10-09")));
    expect(v.findings).toEqual([]);
    expect(v.excused).toEqual(found);
  });

  it.each([
    ["no real reason", "plus tard", "2026-10-09"],
    ["no date", REASON, "bientôt"],
  ])("an exception with %s is itself a gap, and excuses nothing", (_, reason, date) => {
    const v = applyExceptions(found, parseExceptions(file(reason, date)));
    expect(v.findings.map((g) => g.check).sort()).toEqual(["format", "secrets"]);
  });

  it("an exception that no longer excuses anything is a gap: the list never silts up", () => {
    const v = applyExceptions([], parseExceptions(file(REASON, "2026-10-09")));
    expect(v.findings.map((g) => g.detail)).toEqual([expect.stringMatching(/n'excuse plus rien/)]);
  });

  it("no table: no exception", () => {
    expect(parseExceptions("Aucune exception aujourd'hui.")).toEqual([]);
  });
});
