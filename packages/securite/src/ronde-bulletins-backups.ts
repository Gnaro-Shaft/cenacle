/**
 * The backups in the ronde's file for the page (ADR-0043, S2b): for each
 * machine, the sources parc.local.toml declares, and — when its bulletin was
 * read — what the ronde judged of each source it knows. The page shows the
 * ronde's words and never judges again: a source nobody declared is shown,
 * never judged. Numbers and fixed words only: no motif's text ever reaches
 * this file (the bulletin recites none).
 *
 * Read back as strictly as the rest of the file: a source twice, a word the
 * ronde does not write, a verdict that contradicts its judgment — the whole
 * file is unreadable, never half shown.
 */
import { BACKUP_SOURCES, type BackupSource } from "./bulletin-backups.ts";
import { BACKUP_JUDGMENTS, type BackupJudgment, type JudgedBackup } from "./ronde-backups.ts";

export interface FileBackup {
  readonly source: BackupSource;
  readonly judgment: BackupJudgment;
  /** The writer's verdict; null when the bulletin recites none (absent, unreadable). */
  readonly verdict: "SAIN" | "MALADE" | null;
  /** When the writer judged, in ms (the server's clock); null with the verdict. */
  readonly at: number | null;
  /** Since when it is ill, in ms; null when healthy, or with no verdict. */
  readonly since: number | null;
  /** How many motifs it wrote (their text stays on the server); null with the verdict. */
  readonly motifs: number | null;
}

/** The ronde's judgments, as the file carries them. */
export function fileBackups(judged: readonly JudgedBackup[]): FileBackup[] {
  return judged.map(({ source, judgment, recited }) =>
    recited === null || recited.read === "illisible"
      ? { source, judgment, verdict: null, at: null, since: null, motifs: null }
      : {
          source,
          judgment,
          verdict: recited.verdict,
          at: recited.at,
          since: recited.since,
          motifs: recited.motifs,
        },
  );
}

const MAX_MS = 1e14;
const MAX_MOTIFS = 1000;

type Fail = (what: string) => never;
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
const isSource = (v: unknown): v is BackupSource =>
  typeof v === "string" && (BACKUP_SOURCES as readonly string[]).includes(v);
const isJudgment = (v: unknown): v is BackupJudgment =>
  typeof v === "string" && (BACKUP_JUDGMENTS as readonly string[]).includes(v);
const BACKUP_KEYS = ["source", "judgment", "verdict", "at", "since", "motifs"];

/** The sources a machine declares: each of the closed list, at most once. */
export function declaredOf(v: unknown, fail: Fail): BackupSource[] {
  if (!Array.isArray(v) || v.length > BACKUP_SOURCES.length) return fail("declared");
  const out: BackupSource[] = [];
  for (const s of v) {
    if (!isSource(s) || out.includes(s)) return fail("declared");
    out.push(s);
  }
  return out;
}

/** What a verdict must say for its judgment: no SAIN judged ill, no MALADE judged healthy. */
function agrees(judgment: BackupJudgment, verdict: FileBackup["verdict"]): boolean {
  switch (judgment) {
    case "absente":
    case "illisible":
      return verdict === null;
    case "sain":
      return verdict === "SAIN";
    case "malade":
      return verdict === "MALADE";
    case "perimee":
    case "future":
      return verdict !== null;
    case "non-declaree":
      return true;
  }
}

function backupOf(v: unknown, fail: Fail): FileBackup {
  if (!record(v) || Object.keys(v).length !== BACKUP_KEYS.length) return fail("backup");
  if (!BACKUP_KEYS.every((k) => Object.hasOwn(v, k))) return fail("backup");
  const { source, judgment, verdict, at, since, motifs } = v;
  if (!isSource(source) || !isJudgment(judgment)) return fail("backup source");
  if (verdict === null) {
    if (at !== null || since !== null || motifs !== null) return fail("backup half said");
    if (!agrees(judgment, null)) return fail("backup judgment");
    return { source, judgment, verdict, at: null, since: null, motifs: null };
  }
  if (verdict !== "SAIN" && verdict !== "MALADE") return fail("backup verdict");
  if (!agrees(judgment, verdict)) return fail("backup judgment");
  if (!count(at, MAX_MS) || !count(motifs, MAX_MOTIFS)) return fail("backup half said");
  if (since !== null && (!count(since, MAX_MS) || since > at)) return fail("backup since");
  return { source, judgment, verdict, at, since, motifs };
}

/**
 * A machine's judged sources, against what it declares — as backupJudgments
 * writes them: every declared one, in the declared order, then only
 * undeclared ones. Null when its bulletin recites none.
 */
export function backupsOf(
  v: unknown,
  declared: readonly BackupSource[],
  fail: Fail,
): FileBackup[] | null {
  if (v === null) return null;
  if (!Array.isArray(v) || v.length > BACKUP_SOURCES.length) return fail("backups");
  const out = v.map((b) => backupOf(b, fail));
  if (new Set(out.map((b) => b.source)).size !== out.length) return fail("a backup twice");
  if (out.length < declared.length) return fail("a declared backup missing");
  for (const [i, b] of out.entries()) {
    const ok =
      i < declared.length
        ? b.source === declared[i] && b.judgment !== "non-declaree"
        : b.judgment === "non-declaree";
    if (!ok) return fail("backups against declared");
  }
  return out;
}
