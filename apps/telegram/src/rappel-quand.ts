/**
 * When a reminder is due (ADR-0041, point 3): a closed grammar, read in
 * Paris time, turned into an instant — never guessed, never read by a model.
 *
 *   2026-11-20 09:00    a date and an hour
 *   20/11 09:00         this year, or next year when already past (never
 *                       when it is today's: that is a mistake, said)
 *   20/11/2026 09:00    a date with its year
 *   demain 09:00        tomorrow, in Paris
 *   dans 2 h            from now: min, h or j (a day is 24 hours)
 *
 * An hour is 09:00, 9:00, 9h or 9h30.
 *
 * Refused, and said: a form it does not know, a date that does not exist,
 * an hour skipped by the change of time (it does not exist that day) or one
 * met twice (it is ambiguous), an instant already past, one more than a year
 * ahead. Pure: the text and the time now, in; an instant and the rest, out.
 */
import { TIME_ZONE } from "@cenacle/core";

/** A year at most: a reminder further away is a calendar's work. */
export const MAX_AHEAD_MS = 366 * 86_400_000;

interface Wall {
  readonly y: number;
  readonly mo: number;
  readonly d: number;
  readonly h: number;
  readonly mi: number;
}

const PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** The wall clock in Paris at an instant. */
function wallOf(t: Date): Wall {
  const parts = PARTS.formatToParts(t);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute") };
}

const same = (a: Wall, b: Wall) =>
  a.y === b.y && a.mo === b.mo && a.d === b.d && a.h === b.h && a.mi === b.mi;

export type WallProblem = "invalide" | "inexistante" | "double";

/**
 * The instant a Paris wall clock shows — Paris is one or two hours ahead of
 * UTC, so it is one of two instants: none matching, the hour was skipped;
 * both, it came twice.
 */
export function wallToInstant(w: Wall): Date | WallProblem {
  if (w.mo < 1 || w.mo > 12 || w.d < 1 || w.d > 31 || w.h > 23 || w.mi > 59) return "invalide";
  const base = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
  const day = new Date(base);
  if (day.getUTCFullYear() !== w.y || day.getUTCMonth() !== w.mo - 1 || day.getUTCDate() !== w.d) {
    return "invalide";
  }
  const hits = [60, 120]
    .map((minutes) => new Date(base - minutes * 60_000))
    .filter((t) => same(wallOf(t), w));
  if (hits.length === 0) return "inexistante";
  if (hits.length > 1) return "double";
  return hits[0] as Date;
}

export type When = { readonly at: Date; readonly rest: string } | { readonly error: string };

export const WHEN_FORMS = "2026-11-20 09:00, 20/11 09:00, demain 09:00 ou dans 2 h";

const PAST = "cette échéance est déjà passée";
const PROBLEM: Readonly<Record<WallProblem, string>> = {
  invalide: "cette date n'existe pas",
  inexistante: "cette heure n'existe pas ce jour-là (changement d'heure)",
  double: "cette heure revient deux fois ce jour-là (changement d'heure) : choisis-en une autre",
};

const HOUR = String.raw`(\d{1,2})(?:[:h](\d{2})|h)`;
const END = String.raw`(?:\s+|$)`;
const ISO = new RegExp(String.raw`^(\d{4})-(\d{2})-(\d{2})\s+${HOUR}${END}`, "i");
const DAY_MONTH = new RegExp(String.raw`^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s+${HOUR}${END}`, "i");
const TOMORROW = new RegExp(String.raw`^demain\s+${HOUR}${END}`, "i");
const IN = /^dans\s+(\d{1,6})\s*(min|minutes?|h|heures?|j|jours?)(?:\s+|$)/i;
const UNIT_MS: Readonly<Record<string, number>> = { min: 60_000, h: 3_600_000, j: 86_400_000 };

/** An instant checked against now: in the future, within a year. */
function bounded(at: Date, now: Date, rest: string): When {
  if (at.getTime() <= now.getTime()) return { error: PAST };
  if (at.getTime() - now.getTime() > MAX_AHEAD_MS) return { error: "à plus d'un an : trop loin" };
  return { at, rest: rest.trim() };
}

function fromWall(w: Wall, now: Date, rest: string): When {
  const at = wallToInstant(w);
  return typeof at === "string" ? { error: PROBLEM[at] } : bounded(at, now, rest);
}

/** "9h": no minutes said, so on the hour. */
const minutes = (group: string | undefined) => (group === undefined ? 0 : Number(group));

const unitOf = (word: string) => {
  const w = word.toLowerCase();
  return w.startsWith("min") ? "min" : w.startsWith("h") ? "h" : "j";
};

/** Reads when, at the start of the text; the rest is the reminder's text. */
export function parseWhen(input: string, now: Date): When {
  const text = input.trim();
  let m = ISO.exec(text);
  if (m !== null) {
    const [y, mo, d, h] = m.slice(1, 5).map(Number) as [number, number, number, number];
    return fromWall({ y, mo, d, h, mi: minutes(m[5]) }, now, text.slice(m[0].length));
  }
  m = DAY_MONTH.exec(text);
  if (m !== null) {
    const [d, mo] = m.slice(1, 3).map(Number) as [number, number];
    const h = Number(m[4]);
    const mi = minutes(m[5]);
    const rest = text.slice(m[0].length);
    if (m[3] !== undefined) return fromWall({ y: Number(m[3]), mo, d, h, mi }, now, rest);
    const today = wallOf(now);
    const thisYear = fromWall({ y: today.y, mo, d, h, mi }, now, rest);
    // Past this year: next year's — but past earlier today is a mistake, said;
    // and a date that does not exist stays refused.
    if ("error" in thisYear && thisYear.error === PAST && !(d === today.d && mo === today.mo)) {
      return fromWall({ y: today.y + 1, mo, d, h, mi }, now, rest);
    }
    return thisYear;
  }
  m = TOMORROW.exec(text);
  if (m !== null) {
    const today = wallOf(now);
    const next = new Date(Date.UTC(today.y, today.mo - 1, today.d + 1));
    const h = Number(m[1]);
    const w = {
      y: next.getUTCFullYear(),
      mo: next.getUTCMonth() + 1,
      d: next.getUTCDate(),
      h,
      mi: minutes(m[2]),
    };
    return fromWall(w, now, text.slice(m[0].length));
  }
  m = IN.exec(text);
  if (m !== null) {
    const n = Number(m[1]);
    if (n < 1) return { error: "au moins 1 (dans 1 min, dans 1 h, dans 1 j)" };
    const at = new Date(now.getTime() + n * (UNIT_MS[unitOf(m[2] ?? "")] ?? 0));
    return bounded(at, now, text.slice(m[0].length));
  }
  return { error: `quand ? ${WHEN_FORMS}` };
}

const SAID = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TIME_ZONE,
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** « jeudi 20/11 à 09:00 », and the year when it is not this year's. */
export function sayWhen(at: Date, now: Date): string {
  const parts = SAID.formatToParts(at);
  const p = (type: string) => parts.find((x) => x.type === type)?.value ?? "";
  const year = wallOf(at).y === wallOf(now).y ? "" : `/${wallOf(at).y}`;
  return `${p("weekday")} ${p("day")}/${p("month")}${year} à ${p("hour")}:${p("minute")}`;
}
