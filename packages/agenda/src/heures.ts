/**
 * From a reading of the agenda to what Telegram may receive (ADR-0042,
 * point 7): per Paris day, the start times "HH:MM", the whole days and the
 * events begun the day before — counts and hours, never a title. The type it
 * returns has no field a title could go into.
 */
import { zonedParts } from "@cenacle/core";
import type { AgendaView } from "./lecture.ts";
import {
  type DayHours,
  type HoursView,
  MAX_ANSWER_DAYS,
  MAX_HOURS_PER_DAY,
} from "./prise-protocole.ts";
import { addDays, type CivilDate, isoDate, localToInstant, PARIS } from "./times.ts";

const pad = (n: number) => String(n).padStart(2, "0");

/** "09:05", Paris. */
export function parisHour(instant: number): string {
  const p = zonedParts(instant, PARIS);
  // Some engines say hour 24 for midnight.
  return `${pad(p.h === 24 ? 0 : p.h)}:${pad(p.min)}`;
}

function parseDay(iso: string): CivilDate {
  const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
  return { y, m, d };
}

const midnight = (date: CivilDate) => localToInstant({ ...date, h: 0, min: 0, s: 0 }, PARIS);

/**
 * The hours of `count` Paris days from `first` ("2026-11-18"), out of a
 * reading whose window holds them.
 */
export function hoursOf(view: AgendaView, first: string, count: number): HoursView {
  if (view.read === "absent") return { read: "absent" };
  // The reason stays on the page: it may name an account's settings.
  if (view.read === "config") return { read: "config" };
  if (!Number.isInteger(count) || count < 1 || count > MAX_ANSWER_DAYS) {
    throw new RangeError("count");
  }
  const days: DayHours[] = [];
  for (let i = 0; i < count; i++) {
    const date = addDays(parseDay(first), i);
    const iso = isoDate(date);
    const start = midnight(date);
    const end = midnight(addDays(date, 1));
    const starts: number[] = [];
    let wholeDays = 0;
    let ongoing = 0;
    for (const e of view.events) {
      if (e.kind === "journee") {
        if (e.first <= iso && iso <= e.last) wholeDays++;
      } else if (e.start >= start && e.start < end) {
        starts.push(e.start);
      } else if (e.start < start && e.end > start) {
        ongoing++;
      }
    }
    starts.sort((a, b) => a - b);
    days.push({
      date: iso,
      hours: starts.slice(0, MAX_HOURS_PER_DAY).map(parisHour),
      more: Math.max(0, starts.length - MAX_HOURS_PER_DAY),
      wholeDays,
      ongoing,
    });
  }
  const failures = view.accounts.flatMap((a) =>
    a.state === "ok" ? [] : [{ account: a.name, state: a.state }],
  );
  const setAside = view.setAside.reduce((sum, s) => sum + s.count, 0);
  return { read: "ok", days, failures, setAside };
}
