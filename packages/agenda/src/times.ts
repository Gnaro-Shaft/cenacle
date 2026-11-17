/**
 * The agenda's dates (ADR-0042, point 4). The window is counted in Paris
 * calendar days, midnight to midnight, each computed in the zone: a change of
 * hour never ends it at 23:00 or 01:00. A local time in a known zone (IANA)
 * becomes an instant by RFC 5545, § 3.3.5: a time that does not exist (the
 * spring gap) is read with the offset before the gap; a time that exists
 * twice (the autumn overlap) is its first occurrence. A whole day stays its
 * date, never converted.
 */
import { zonedParts } from "@cenacle/core";

export const PARIS = "Europe/Paris";
export const DEFAULT_DAYS = 7;
export const MAX_DAYS = 31;
const DAY_MS = 86_400_000;

/** A calendar date, months 1-12. */
export interface CivilDate {
  readonly y: number;
  readonly m: number;
  readonly d: number;
}

export interface LocalTime extends CivilDate {
  readonly h: number;
  readonly min: number;
  readonly s: number;
}

/** A date valid in the Gregorian calendar (no 31 February), years 1900-2199. */
export function validDate(date: CivilDate): boolean {
  const { y, m, d } = date;
  if (!Number.isInteger(y) || y < 1900 || y > 2199) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** The date `days` after (or before) this one. */
export function addDays(date: CivilDate, days: number): CivilDate {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** "2026-11-17". */
export function isoDate(date: CivilDate): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(date.y, 4)}-${pad(date.m)}-${pad(date.d)}`;
}

/** Days from a to b (b later: positive). */
export function daysBetween(a: CivilDate, b: CivilDate): number {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY_MS);
}

/** True when the zone is one the clock knows (an IANA name); a Windows name is not. */
export function knownZone(zone: string): boolean {
  if (zone.length === 0 || zone.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The zone's offset from UTC at that instant, in ms. */
function offsetAt(instant: number, zone: string): number {
  const p = zonedParts(instant, zone);
  // Some engines say hour 24 for midnight.
  const wall = Date.UTC(p.y, p.m - 1, p.d, p.h === 24 ? 0 : p.h, p.min, p.s);
  return wall - Math.floor(instant / 1000) * 1000;
}

/** The instant of a local time in a known zone, by RFC 5545, § 3.3.5. */
export function localToInstant(local: LocalTime, zone: string): number {
  const wall = Date.UTC(local.y, local.m - 1, local.d, local.h, local.min, local.s);
  // A zone changes its offset at most once within two days (true of every real zone).
  const before = offsetAt(wall - DAY_MS, zone);
  const after = offsetAt(wall + DAY_MS, zone);
  const valid = [...new Set([before, after])]
    .map((offset) => wall - offset)
    .filter((instant) => wall - offsetAt(instant, zone) === instant)
    .sort((a, b) => a - b);
  // Twice: the first occurrence. Never: the offset before the gap.
  return valid[0] ?? wall - before;
}

/** The Paris date of an instant. */
export function parisDate(instant: number): CivilDate {
  const p = zonedParts(instant, PARIS);
  return { y: p.y, m: p.m, d: p.d };
}

export interface Window {
  /** The first day, in Paris. */
  readonly from: CivilDate;
  readonly days: number;
  /** Midnight of the first day, Paris. */
  readonly start: number;
  /** Midnight after the last day, Paris. */
  readonly end: number;
}

/** The window of `days` Paris days from today's midnight. */
export function windowOf(now: number, days: number): Window {
  const from = parisDate(now);
  const midnight = (date: CivilDate) => localToInstant({ ...date, h: 0, min: 0, s: 0 }, PARIS);
  return { from, days, start: midnight(from), end: midnight(addDays(from, days)) };
}

/** "20261117T080000Z", the form CalDAV's time-range and expand want. */
export function caldavUtc(instant: number): string {
  return new Date(instant)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}
