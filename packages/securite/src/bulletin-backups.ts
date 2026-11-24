/**
 * What a version 3 bulletin adds (ADR-0043): the state of the backup
 * verdicts present on the machine — a closed list of sources, each said
 * either unreadable, or SAIN|MALADE with its instant, the start of its
 * illness and the number of its motifs. Never a motif's text: motifs carry
 * addresses and host names, and the bulletin recites none.
 *
 * As strict as the rest of the reader: a source half said, a key it does not
 * know, a value out of shape — the whole bulletin is unreadable.
 */
import { BulletinError, whole } from "./bulletin-fields.ts";
import type { Severity } from "./types.ts";

/** The sources the bulletin may read, each at its fixed path (deploy/serveurs/cenacle-bulletin). */
export const BACKUP_SOURCES = [
  "copie-dumps",
  "veiller-sauvegardes",
  "copie-bases",
  "myriade-base",
  // Cénacle's own copy of its base, judged by veiller-copie-cenacle (ADR-0044, B2).
  "copie-cenacle",
  // Not a backup: the house's weekly quality verdict (ADR-0047), same form.
  "maison",
] as const;
export type BackupSource = (typeof BACKUP_SOURCES)[number];

export interface SourceFacts {
  /** Where its writer leaves the verdict, on its machine. */
  readonly path: string;
  /** How I read it there by hand, motifs included. */
  readonly read: string;
  /** How the findings and the page name it. */
  readonly name: string;
  /** Its writer runs each night, or each week (ADR-0047). */
  readonly rhythm: "nightly" | "weekly";
  /** Its findings: a backup lost comes with the morning report (ADR-0043); a bad week of the house, less (ADR-0047). */
  readonly severity: Severity;
}

const nightly = (source: string): SourceFacts => ({
  path: `/var/lib/${source}/verdict`,
  read: `cat /var/lib/${source}/verdict`,
  name: `sauvegarde ${source}`,
  rhythm: "nightly",
  severity: "eleve",
});

/** What the bulletin, the ronde and the catalogue know of each source. */
export const SOURCE_FACTS: Readonly<Record<BackupSource, SourceFacts>> = {
  "copie-dumps": nightly("copie-dumps"),
  "veiller-sauvegardes": nightly("veiller-sauvegardes"),
  "copie-bases": nightly("copie-bases"),
  "myriade-base": nightly("myriade-base"),
  "copie-cenacle": nightly("copie-cenacle"),
  maison: {
    path: "/var/lib/maison/mesure/verdict",
    // Its folder is closed to all but root; only the bulletin's account may pass (ADR-0047).
    read: "sudo cat /var/lib/maison/mesure/verdict",
    name: "mesure de la maison",
    rhythm: "weekly",
    severity: "moyen",
  },
};

export type BackupState =
  | { readonly source: BackupSource; readonly read: "illisible" }
  | {
      readonly source: BackupSource;
      readonly read: "ok";
      readonly verdict: "SAIN" | "MALADE";
      /** When the writer judged, in ms (the server's clock). */
      readonly at: number;
      /** Since when it is ill, in ms; null when it says "-" (healthy). */
      readonly since: number | null;
      readonly motifs: number;
    };

/** A backup key: sauvegarde.<source>.<field>. */
export const BACKUP_KEY =
  /^sauvegarde\.(copie-dumps|veiller-sauvegardes|copie-bases|myriade-base|copie-cenacle|maison)\.(lecture|verdict|instant|depuis|motifs)$/;

const MAX_INSTANT = 99_999_999_999;
const MAX_MOTIFS = 1000;

/** The sources a bulletin recites, in the list's order; [] when it recites none. */
export function parseBackups(fields: ReadonlyMap<string, string>): BackupState[] {
  const out: BackupState[] = [];
  for (const source of BACKUP_SOURCES) {
    const prefix = `sauvegarde.${source}.`;
    const own = [...fields.keys()].filter((k) => k.startsWith(prefix));
    if (own.length === 0) continue;
    const key = (f: string) => `${prefix}${f}`;
    if (fields.has(key("lecture"))) {
      if (fields.get(key("lecture")) !== "illisible" || own.length !== 1) {
        throw new BulletinError(`${source} : lecture out of shape`);
      }
      out.push({ source, read: "illisible" });
      continue;
    }
    const verdict = fields.get(key("verdict"));
    if (verdict !== "SAIN" && verdict !== "MALADE") {
      throw new BulletinError(`${source} : verdict out of shape`);
    }
    const instant = whole(fields, key("instant"), MAX_INSTANT);
    const motifs = whole(fields, key("motifs"), MAX_MOTIFS);
    const since = whole(fields, key("depuis"), MAX_INSTANT);
    if (instant === null || motifs === null) throw new BulletinError(`${source} : half said`);
    if (since !== null && since > instant)
      throw new BulletinError(`${source} : ill after its instant`);
    out.push({
      source,
      read: "ok",
      verdict,
      at: instant * 1000,
      since: since === null ? null : since * 1000,
      motifs,
    });
  }
  return out;
}
