/**
 * The events of a CalDAV `calendar-data` (ADR-0042, points 2 and 4). Of an
 * event only the title and its times are kept; every other property —
 * attendees, organiser, place, description, attachments — is ignored as it is
 * read, never returned, never logged, even when the server sends the whole
 * event. A property of a component inside the event (an alarm) is not the
 * event's.
 *
 * An event that cannot be placed is set aside with a reason from a closed
 * list, never an excerpt: a floating time, an unknown zone, a series the
 * server did not expand, or an unreadable one. A whole day stays its date.
 */
import {
  addDays,
  type CivilDate,
  daysBetween,
  isoDate,
  knownZone,
  type LocalTime,
  localToInstant,
  validDate,
} from "./times.ts";

export const MAX_TITLE = 200;

export type SetAsideReason =
  | "fuseau-inconnu"
  | "heure-flottante"
  | "serie-non-etendue"
  | "illisible";

export type CalendarEvent =
  | { readonly kind: "heure"; readonly title: string; readonly start: number; readonly end: number }
  | {
      readonly kind: "journee";
      readonly title: string;
      /** The first and last days, inclusive: "2026-11-17". */
      readonly first: string;
      readonly last: string;
    };

export type EventRead =
  | { readonly ok: true; readonly event: CalendarEvent }
  | { readonly ok: false; readonly reason: SetAsideReason };

interface Prop {
  readonly name: string;
  readonly params: ReadonlyMap<string, string>;
  readonly value: string;
}

/** NAME;PARAM=a;PARAM="b:c":value — the colon inside quotes is not the separator. */
function parseLine(line: string): Prop | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;
  const [name = "", ...rawParams] = line.slice(0, colon).split(";");
  const params = new Map<string, string>();
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq <= 0) continue;
    params.set(p.slice(0, eq).toUpperCase(), p.slice(eq + 1).replace(/^"(.*)"$/, "$1"));
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

/** Text written by others: unescaped, control and direction characters removed, bounded. */
export function cleanTitle(raw: string): string {
  const text = raw
    .replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? " " : c))
    .replace(/[\p{Cc}؜‎‏‪-‮⁦-⁩]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(text).slice(0, MAX_TITLE).join("");
}

type When =
  | { readonly kind: "date"; readonly date: CivilDate }
  | {
      readonly kind: "time";
      readonly local: LocalTime;
      readonly zone: string | null;
      readonly utc: boolean;
    };

const DATE = /^(\d{4})(\d{2})(\d{2})$/;
const DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;

function parseWhen(prop: Prop): When | null {
  const value = prop.value.trim();
  const d = DATE.exec(value);
  if (d !== null || prop.params.get("VALUE")?.toUpperCase() === "DATE") {
    if (d === null) return null;
    const date = { y: Number(d[1]), m: Number(d[2]), d: Number(d[3]) };
    return validDate(date) ? { kind: "date", date } : null;
  }
  const t = DATE_TIME.exec(value);
  if (t === null) return null;
  const local = {
    y: Number(t[1]),
    m: Number(t[2]),
    d: Number(t[3]),
    h: Number(t[4]),
    min: Number(t[5]),
    // A leap second is the second before.
    s: Math.min(Number(t[6]), 59),
  };
  if (!validDate(local) || local.h > 23 || local.min > 59 || Number(t[6]) > 60) return null;
  return { kind: "time", local, zone: prop.params.get("TZID") ?? null, utc: t[7] === "Z" };
}

/** The instant of a time, or why it cannot be placed. */
function instantOf(when: When & { kind: "time" }): number | SetAsideReason {
  const { local } = when;
  if (when.utc) return Date.UTC(local.y, local.m - 1, local.d, local.h, local.min, local.s);
  if (when.zone === null) return "heure-flottante";
  if (!knownZone(when.zone)) return "fuseau-inconnu";
  return localToInstant(local, when.zone);
}

const DURATION =
  /^\+?P(?:(\d{1,4})W|(?:(\d{1,5})D)?(?:T(?:(\d{1,6})H)?(?:(\d{1,7})M)?(?:(\d{1,9})S)?)?)$/;

/** Days and seconds of a positive duration, or null. */
function parseDuration(value: string): { days: number; seconds: number } | null {
  const v = value.trim();
  const m = DURATION.exec(v);
  if (m === null || v.endsWith("P") || v.endsWith("T")) return null;
  const n = (i: number) => Number(m[i] ?? 0);
  return { days: n(1) * 7 + n(2), seconds: n(3) * 3600 + n(4) * 60 + n(5) };
}

const MAX_SPAN_DAYS = 3660;

/** One VEVENT's properties made into an event, or set aside. */
function toEvent(props: readonly Prop[]): EventRead {
  const one = (name: string) => {
    const found = props.filter((p) => p.name === name);
    return found.length > 1 ? "twice" : (found[0] ?? null);
  };
  const summary = one("SUMMARY");
  const dtstart = one("DTSTART");
  const dtend = one("DTEND");
  const duration = one("DURATION");
  const unreadable = { ok: false, reason: "illisible" } as const;
  if (props.some((p) => p.name === "RRULE")) return { ok: false, reason: "serie-non-etendue" };
  if ([summary, dtstart, dtend, duration].includes("twice")) return unreadable;
  if (dtstart === null || typeof dtstart === "string") return unreadable;
  if (
    typeof dtend !== "string" &&
    dtend !== null &&
    typeof duration !== "string" &&
    duration !== null
  ) {
    return unreadable; // both an end and a duration: which one holds is not ours to guess
  }
  const title = typeof summary === "object" && summary !== null ? cleanTitle(summary.value) : "";
  const start = parseWhen(dtstart);
  if (start === null) return unreadable;
  const end = typeof dtend === "object" && dtend !== null ? parseWhen(dtend) : undefined;
  const span =
    typeof duration === "object" && duration !== null ? parseDuration(duration.value) : undefined;
  if (end === null || span === null) return unreadable;

  if (start.kind === "date") {
    let last = start.date;
    if (end !== undefined) {
      if (end.kind !== "date") return unreadable;
      if (daysBetween(start.date, end.date) > 0) last = addDays(end.date, -1);
    } else if (span !== undefined && span.days > 0) {
      last = addDays(start.date, span.days - 1);
    }
    if (daysBetween(start.date, last) > MAX_SPAN_DAYS) return unreadable;
    return {
      ok: true,
      event: { kind: "journee", title, first: isoDate(start.date), last: isoDate(last) },
    };
  }

  const from = instantOf(start);
  if (typeof from === "string") return { ok: false, reason: from };
  let to = from;
  if (end !== undefined) {
    if (end.kind !== "time") return unreadable;
    const t = instantOf(end);
    if (typeof t === "string") return { ok: false, reason: t };
    if (t < from) return unreadable;
    to = t;
  } else if (span !== undefined) {
    // Days are calendar days in the event's zone (RFC 5545, § 3.3.6); seconds are exact.
    const zoned = !start.utc && start.zone !== null;
    const shifted = zoned
      ? localToInstant({ ...start.local, ...addDays(start.local, span.days) }, start.zone ?? "")
      : from + span.days * 86_400_000;
    to = shifted + span.seconds * 1000;
  }
  if (to - from > MAX_SPAN_DAYS * 86_400_000) return unreadable;
  return { ok: true, event: { kind: "heure", title, start: from, end: to } };
}

/** Every VEVENT of one calendar-data; a broken structure is one unreadable reading. */
export function readCalendarData(text: string): EventRead[] {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const stack: string[] = [];
  const reads: EventRead[] = [];
  let props: Prop[] | null = null;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const prop = parseLine(line);
    if (prop === null) {
      if (stack.at(-1) === "VEVENT") return [...reads, { ok: false, reason: "illisible" }];
      continue;
    }
    if (prop.name === "BEGIN") {
      const component = prop.value.trim().toUpperCase();
      stack.push(component);
      if (stack.length > 16) return [...reads, { ok: false, reason: "illisible" }];
      if (component === "VEVENT") props = [];
      continue;
    }
    if (prop.name === "END") {
      const component = prop.value.trim().toUpperCase();
      if (stack.pop() !== component) return [...reads, { ok: false, reason: "illisible" }];
      if (component === "VEVENT" && props !== null) {
        reads.push(toEvent(props));
        props = null;
      }
      continue;
    }
    // Only the event's own properties, never those of an alarm inside it.
    if (stack.at(-1) === "VEVENT" && props !== null) props.push(prop);
  }
  if (stack.length > 0) return [...reads, { ok: false, reason: "illisible" }];
  return reads;
}

/** True when the event meets the window [start, end) — Paris days for a whole day. */
export function meetsWindow(
  event: CalendarEvent,
  window: {
    readonly start: number;
    readonly end: number;
    readonly first: string;
    readonly last: string;
  },
): boolean {
  if (event.kind === "journee") return event.last >= window.first && event.first <= window.last;
  if (event.end === event.start) return event.start >= window.start && event.start < window.end;
  return event.end > window.start && event.start < window.end;
}
