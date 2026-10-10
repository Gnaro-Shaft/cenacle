/**
 * Do the registers, the cadre, the code and the documentation agree?
 * (ADR-0022) Deterministic, no AI: pure functions over facts gathered by
 * facts.ts. Each disagreement is a finding; none is guessed away.
 */
import { type Row, table } from "./markdown.ts";

export type CheckName =
  | "durées"
  | "tables"
  | "services"
  | "ia"
  | "secrets"
  | "références"
  | "format";

export interface Finding {
  readonly check: CheckName;
  /** What it is about: a key, a table, a host, an agent, a file, a reference. */
  readonly subject: string;
  readonly detail: string;
}

export interface Facts {
  /** docs/conformite/registre-traitements.md */
  readonly register: string;
  /** docs/conformite/registre-ia.md */
  readonly registerIa: string;
  /** docs/securite/secrets.md */
  readonly secretsDoc: string;
  /** Each cadre read: its name, and its [conservation] durations in days. */
  readonly cadres: readonly {
    readonly name: string;
    readonly conservation: Readonly<Record<string, number>>;
  }[];
  /** Tempo's block retentions, in hours (deploy/observability/tempo.yaml). */
  readonly tempoRetentionHours: readonly number[];
  /** Tables the migrations create. */
  readonly tables: readonly string[];
  /** A tracked file's text, or null. */
  readonly file: (path: string) => string | null;
  /** External hosts the code contacts, written in it. */
  readonly hosts: readonly { readonly host: string; readonly path: string }[];
  /** Agents that ask a model. */
  readonly agents: readonly string[];
  /** The secret families' files, as the code declares them. */
  readonly secretFiles: readonly string[];
  /** ADR numbers that exist. */
  readonly adrs: ReadonlySet<string>;
  /** References a document cites that cannot be found (ADRs, files, scripts). */
  readonly missingReferences: (path: string, text: string) => readonly string[];
  /** The documents whose references are checked. */
  readonly docs: readonly { readonly path: string; readonly text: string }[];
}

const finding = (check: CheckName, subject: string, detail: string): Finding => ({
  check,
  subject,
  detail,
});

/** Every duration the register ties to a cadre key equals that key, in every cadre read. */
export function checkDurations(f: Facts): Finding[] {
  const out: Finding[] = [];
  const rows = table(f.register, "#", "le registre des traitements");
  const cited = new Set<string>();
  for (const row of rows) {
    const id = row["#"] ?? "?";
    const cell = row.Conservation ?? "";
    for (const m of cell.matchAll(/(\d+)\s*jours\**\s*\(`([a-z_]+)`\)/g)) {
      const days = Number(m[1]);
      const key = m[2] ?? "";
      cited.add(key);
      for (const cadre of f.cadres) {
        const value = cadre.conservation[key];
        if (value === undefined) {
          out.push(finding("durées", key, `${id} cite \`${key}\`, absent de ${cadre.name}`));
        } else if (value !== days) {
          out.push(
            finding("durées", key, `${id} dit ${days} jours, ${cadre.name} applique ${value}`),
          );
        }
      }
    }
    for (const m of cell.matchAll(/(\d+)\s*jours\**\s*\(`deploy\/observability\/tempo\.yaml`\)/g)) {
      const days = Number(m[1]);
      if (f.tempoRetentionHours.length === 0) {
        out.push(
          finding("durées", "tempo", `${id} cite tempo.yaml, où aucune rétention n'est lue`),
        );
      }
      for (const hours of f.tempoRetentionHours) {
        if (hours !== days * 24) {
          out.push(
            finding("durées", "tempo", `${id} dit ${days} jours, tempo.yaml garde ${hours} h`),
          );
        }
      }
    }
  }
  for (const cadre of f.cadres) {
    for (const key of Object.keys(cadre.conservation)) {
      if (!cited.has(key)) {
        out.push(
          finding(
            "durées",
            key,
            `\`${key}\` (${cadre.name}) n'est cité par aucune ligne du registre`,
          ),
        );
      }
    }
  }
  return out;
}

/** Every table is declared once: purged by a file that touches it, or holding no personal data. */
export function checkTables(f: Facts): Finding[] {
  const out: Finding[] = [];
  const rows: Row[] = table(f.register, "Table", "le registre des traitements (tables)");
  const declared = new Map(rows.map((r) => [(r.Table ?? "").replace(/`/g, ""), r]));
  for (const t of f.tables) {
    const row = declared.get(t);
    if (row === undefined) {
      out.push(finding("tables", t, `la table \`${t}\` n'est pas déclarée au registre`));
      continue;
    }
    const purge = row.Purge ?? "";
    if (/^aucune donnée personnelle/i.test(purge)) {
      if (purge.length < 40) {
        out.push(finding("tables", t, `\`${t}\` : « aucune donnée personnelle » sans raison`));
      }
      continue;
    }
    const paths = [...purge.matchAll(/`([^`]+\.(?:ts|sql))`/g)].map((m) => m[1] ?? "");
    if (paths.length === 0) {
      out.push(
        finding("tables", t, `\`${t}\` : ni fichier de purge, ni « aucune donnée personnelle »`),
      );
    }
    const touches = new RegExp(`DELETE\\s+FROM\\s+${t}\\b`, "i");
    for (const path of paths) {
      const text = f.file(path);
      if (text === null) out.push(finding("tables", t, `\`${t}\` : \`${path}\` n'existe pas`));
      else if (!touches.test(text)) {
        out.push(finding("tables", t, `\`${t}\` : \`${path}\` ne la purge pas`));
      }
    }
  }
  for (const t of declared.keys()) {
    if (!f.tables.includes(t)) {
      out.push(finding("tables", t, `\`${t}\` est déclarée mais n'existe pas`));
    }
  }
  return out;
}

/** Every external host the code contacts has its line among the third-party services. */
export function checkServices(f: Facts): Finding[] {
  const rows = table(f.register, "Service", "le registre des traitements (services)");
  const text = rows.map((r) => Object.values(r).join(" ")).join("\n");
  return f.hosts
    .filter((h) => !text.includes(`\`${h.host}\``))
    .map((h) =>
      finding(
        "services",
        h.host,
        `\`${h.path}\` contacte \`${h.host}\`, absent des services tiers`,
      ),
    );
}

/** Every agent that asks a model is named in the AI register; every line cites ADRs that exist. */
export function checkAi(f: Facts): Finding[] {
  const out: Finding[] = [];
  const rows = table(f.registerIa, "#", "le registre IA");
  for (const row of rows) {
    const id = row["#"] ?? "?";
    const line = Object.values(row).join(" ");
    const adrs = [...line.matchAll(/ADR-(\d{4})/g)].map((m) => m[1] ?? "");
    if (adrs.length === 0) out.push(finding("ia", id, `${id} ne cite aucun ADR`));
    for (const n of adrs) {
      if (!f.adrs.has(n)) out.push(finding("ia", id, `${id} cite ADR-${n}, qui n'existe pas`));
    }
  }
  const all = rows
    .map((r) => Object.values(r).join(" "))
    .join("\n")
    .toLowerCase();
  for (const agent of f.agents) {
    if (!new RegExp(`\\b${agent}\\b`).test(all)) {
      out.push(
        finding(
          "ia",
          agent,
          `l'agent \`${agent}\` appelle un modèle, et le registre IA ne le nomme pas`,
        ),
      );
    }
  }
  return out;
}

/** The secret families the code refuses and the ones the documentation describes are the same. */
export function checkSecrets(f: Facts): Finding[] {
  const rows = table(f.secretsDoc, "Fichier", "docs/securite/secrets.md");
  const documented = new Set(rows.map((r) => (r.Fichier ?? "").replace(/`/g, "")));
  const out = f.secretFiles
    .filter((file) => !documented.has(file))
    .map((file) =>
      finding(
        "secrets",
        file,
        `\`${file}\` est une famille de secrets du code, absente de la documentation`,
      ),
    );
  for (const file of documented) {
    if (file.startsWith(".env.") && !f.secretFiles.includes(file)) {
      out.push(finding("secrets", file, `\`${file}\` est documenté, et le code ne le connaît pas`));
    }
  }
  return out;
}

/** Every ADR, file and script the compliance documents cite exists. */
export function checkReferences(f: Facts): Finding[] {
  return f.docs.flatMap((d) =>
    f
      .missingReferences(d.path, d.text)
      .map((r) =>
        finding("références", `${d.path} → ${r}`, `\`${d.path}\` cite \`${r}\`, introuvable`),
      ),
  );
}

export const CHECKS = [
  checkDurations,
  checkTables,
  checkServices,
  checkAi,
  checkSecrets,
  checkReferences,
] as const;
