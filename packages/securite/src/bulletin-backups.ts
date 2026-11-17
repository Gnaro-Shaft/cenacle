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

/** The sources the bulletin may read, each at its fixed path (deploy/serveurs/cenacle-bulletin). */
export const BACKUP_SOURCES = [
  "copie-dumps",
  "veiller-sauvegardes",
  "copie-bases",
  "myriade-base",
] as const;
export type BackupSource = (typeof BACKUP_SOURCES)[number];

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
  /^sauvegarde\.(copie-dumps|veiller-sauvegardes|copie-bases|myriade-base)\.(lecture|verdict|instant|depuis|motifs)$/;

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
