/**
 * The options of the sorting measure (mesure:rangement). Pure: no mailbox, no base.
 *   --max <n>            judge at most n mails
 *   --simuler            replay today's sorting next to Iris's (mesure-simulation.ts)
 *   --depuis AAAA-MM-JJ  only the mails arrived from that day on, midnight in
 *                        Paris (decided on 2026-10-21): the time zone of the
 *                        follow-ups. Arrival is the only date kept in base.
 */
import { FOLLOW_UP_TIME_ZONE, UsageError, zonedMidnight } from "@cenacle/core";

export interface Since {
  /** As written, for the report. */
  readonly day: string;
  /** Midnight of that day in Paris, in milliseconds. */
  readonly at: number;
}

export interface MeasureOptions {
  readonly max: number;
  readonly simulate: boolean;
  readonly since: Since | null;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function flagValue(argv: readonly string[], flag: string, what: string): string | null {
  const at = argv.indexOf(flag);
  if (at === -1) return null;
  const value = argv[at + 1];
  if (value === undefined || value.startsWith("--")) throw new UsageError(`${flag} attend ${what}`);
  return value;
}

export function parseSince(day: string): Since {
  const m = DAY.exec(day);
  const [y, mo, d] = m === null ? [Number.NaN, Number.NaN, Number.NaN] : m.slice(1).map(Number);
  // A real calendar day: 2026-02-30 is refused, not rolled over to March.
  const check = new Date(Date.UTC(y as number, (mo as number) - 1, d as number));
  if (
    m === null ||
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== (mo as number) - 1 ||
    check.getUTCDate() !== d
  ) {
    throw new UsageError(`--depuis attend une date AAAA-MM-JJ réelle, pas ${JSON.stringify(day)}`);
  }
  return { day, at: zonedMidnight(y as number, mo as number, d as number, FOLLOW_UP_TIME_ZONE) };
}

export function parseMeasureOptions(argv: readonly string[]): MeasureOptions {
  const maxText = flagValue(argv, "--max", "un nombre positif");
  const max = maxText === null ? Number.POSITIVE_INFINITY : Number(maxText);
  if (!(max > 0)) throw new UsageError("--max attend un nombre positif");
  const day = flagValue(argv, "--depuis", "une date AAAA-MM-JJ");
  return {
    max,
    simulate: argv.includes("--simuler"),
    since: day === null ? null : parseSince(day),
  };
}

/** Arrived at or after midnight of that day in Paris; every mail without --depuis. */
export function arrivedSince(receivedAt: string, since: Since | null): boolean {
  return since === null || Date.parse(receivedAt) >= since.at;
}
