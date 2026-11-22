/**
 * The backups, judged by the ronde (ADR-0043, point 2): for each source a
 * machine declares in parc.local.toml, what its version 3 bulletin recites.
 * MALADE when a declared source is ill, missing, unreadable, older than 36
 * hours or dated more than 5 minutes ahead — both measured against the
 * bulletin's own instant, the server's clock, never the Mac's. A source
 * present but not declared is never judged. A machine that declares sources
 * while its bulletin recites none (versions 1 and 2) is MALADE, never healthy
 * by default.
 *
 * Fixed words, ASCII as the other motifs: the security agent turns each into
 * a `sauvegarde` finding (parse-legion.ts), never copying a writer's motif —
 * the bulletin never recites one.
 */
import type { Bulletin } from "./bulletin.ts";
import type { BackupSource } from "./bulletin-backups.ts";
import type { RondeState } from "./ronde-rules.ts";

/** Every writer runs each night: a day and a half without a verdict is a night missed. */
export const BACKUP_STALE_MS = 36 * 3_600_000;
/** Ahead of the bulletin by more than this: a clock wrong, or a verdict forged. */
export const BACKUP_FUTURE_MS = 5 * 60_000;

/** The words after « sauvegarde <source> », as parse-legion.ts reads them back. */
export const BACKUP_WORDS = {
  ill: "MALADE",
  unreadable: "illisible",
  missing: "sans verdict",
  stale: "sans verdict depuis 36 h",
  future: "datee du futur",
} as const;
/** The motif of a machine declaring sources whose bulletin is too old to recite them. */
export const BACKUPS_NOT_RECITED = "sauvegardes non recitees — bulletin trop ancien";

/** The motifs of the declared sources, in the declared order; none when none is declared. */
export function backupMotifs(
  b: Bulletin,
  declared: readonly BackupSource[],
): [RondeState, string][] {
  if (declared.length === 0) return [];
  if (b.backups === null) return [["MALADE", BACKUPS_NOT_RECITED]];
  const out: [RondeState, string][] = [];
  for (const source of declared) {
    const s = b.backups.find((x) => x.source === source);
    const say = (words: string) => out.push(["MALADE", `sauvegarde ${source} ${words}`]);
    if (s === undefined) say(BACKUP_WORDS.missing);
    else if (s.read === "illisible") say(BACKUP_WORDS.unreadable);
    else if (s.at - b.at > BACKUP_FUTURE_MS) say(BACKUP_WORDS.future);
    else if (b.at - s.at > BACKUP_STALE_MS) say(BACKUP_WORDS.stale);
    else if (s.verdict === "MALADE") say(BACKUP_WORDS.ill);
  }
  return out;
}
