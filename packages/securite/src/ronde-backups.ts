/**
 * The backups, judged by the ronde (ADR-0043, point 2): for each source a
 * machine declares in parc.local.toml, what its version 3 bulletin recites.
 * MALADE when a declared source is ill, missing, unreadable, older than 36
 * hours (8 days for a weekly writer, ADR-0047) or dated more than 5 minutes ahead — both measured against the
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
import { type BackupSource, type BackupState, SOURCE_FACTS } from "./bulletin-backups.ts";
import type { RondeState } from "./ronde-rules.ts";

/** A writer that runs each night: a day and a half without a verdict is a night missed. */
export const BACKUP_STALE_MS = 36 * 3_600_000;
/** A writer that runs each week (the house, ADR-0047): a week and a day. */
export const WEEKLY_STALE_MS = 8 * 24 * 3_600_000;

/** How old a source's verdict may be, by its writer's rhythm. */
export const staleMsOf = (source: BackupSource): number =>
  SOURCE_FACTS[source].rhythm === "weekly" ? WEEKLY_STALE_MS : BACKUP_STALE_MS;
/** Ahead of the bulletin by more than this: a clock wrong, or a verdict forged. */
export const BACKUP_FUTURE_MS = 5 * 60_000;

/** The words after « sauvegarde <source> », as parse-legion.ts reads them back. */
export const BACKUP_WORDS = {
  ill: "MALADE",
  unreadable: "illisible",
  missing: "sans verdict",
  stale: "sans verdict depuis 36 h",
  staleWeekly: "sans verdict depuis 8 j",
  future: "datee du futur",
} as const;
/** The motif of a machine declaring sources whose bulletin is too old to recite them. */
export const BACKUPS_NOT_RECITED = "sauvegardes non recitees — bulletin trop ancien";

/**
 * What the ronde says of one source (S2b): the page shows these words, never
 * judges again. `non-declaree`: recited, not expected — shown, never judged.
 */
export const BACKUP_JUDGMENTS = [
  "sain",
  "malade",
  "illisible",
  "absente",
  "perimee",
  "future",
  "non-declaree",
] as const;
export type BackupJudgment = (typeof BACKUP_JUDGMENTS)[number];

export interface JudgedBackup {
  readonly source: BackupSource;
  readonly judgment: BackupJudgment;
  /** What the bulletin recites of it; null when it recites nothing. */
  readonly recited: BackupState | null;
}

const wordsOf = (
  source: BackupSource,
  judgment: Exclude<BackupJudgment, "sain" | "non-declaree">,
): string => {
  switch (judgment) {
    case "malade":
      return BACKUP_WORDS.ill;
    case "illisible":
      return BACKUP_WORDS.unreadable;
    case "absente":
      return BACKUP_WORDS.missing;
    case "perimee":
      return staleMsOf(source) === WEEKLY_STALE_MS ? BACKUP_WORDS.staleWeekly : BACKUP_WORDS.stale;
    case "future":
      return BACKUP_WORDS.future;
  }
};

function judgeOne(b: Bulletin, s: BackupState | undefined): BackupJudgment {
  if (s === undefined) return "absente";
  if (s.read === "illisible") return "illisible";
  if (s.at - b.at > BACKUP_FUTURE_MS) return "future";
  if (b.at - s.at > staleMsOf(s.source)) return "perimee";
  return s.verdict === "MALADE" ? "malade" : "sain";
}

/**
 * Every source the ronde knows of on this machine: the declared ones first,
 * in the declared order, then the recited ones nobody declared, in the
 * bulletin's order. Null when the bulletin recites none (versions 1 and 2).
 */
export function backupJudgments(
  b: Bulletin,
  declared: readonly BackupSource[],
): JudgedBackup[] | null {
  const recited = b.backups;
  if (recited === null) return null;
  const out: JudgedBackup[] = declared.map((source) => {
    const s = recited.find((x) => x.source === source);
    return { source, judgment: judgeOne(b, s), recited: s ?? null };
  });
  for (const s of recited) {
    if (!declared.includes(s.source)) {
      out.push({ source: s.source, judgment: "non-declaree", recited: s });
    }
  }
  return out;
}

/** The motifs of the declared sources, in the declared order; none when none is declared. */
export function backupMotifs(
  b: Bulletin,
  declared: readonly BackupSource[],
): [RondeState, string][] {
  if (declared.length === 0) return [];
  const judged = backupJudgments(b, declared);
  if (judged === null) return [["MALADE", BACKUPS_NOT_RECITED]];
  const out: [RondeState, string][] = [];
  for (const { source, judgment } of judged) {
    if (judgment === "sain" || judgment === "non-declaree") continue;
    out.push(["MALADE", `sauvegarde ${source} ${wordsOf(source, judgment)}`]);
  }
  return out;
}
