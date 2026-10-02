/**
 * Time that counts for a reply: weekends (Saturday and Sunday, in the given
 * time zone) do not. Daylight-saving changes are handled by the time zone.
 */

const DAY_MS = 24 * 3600 * 1000;

function zonedParts(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    h: get("hour"),
    min: get("minute"),
    s: get("second"),
  };
}

/** Offset of the zone from UTC at that instant, in ms (Paris summer: +2 h). */
function offsetAt(instant: number, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(instant / 1000) * 1000;
}

/** The instant of local midnight of a calendar date (y, m 1-12, d) in the zone. */
export function zonedMidnight(y: number, m: number, d: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - offsetAt(guess, timeZone);
  return guess - offsetAt(first, timeZone);
}

/** Hours between two instants, Saturdays and Sundays (local time) excluded. */
export function workingHoursBetween(start: Date, end: Date, timeZone: string): number {
  const from = start.getTime();
  const to = end.getTime();
  if (!(to > from)) return 0;
  let excluded = 0;
  const first = zonedParts(from, timeZone);
  // Walk calendar days from the start date (UTC arithmetic on the date only).
  for (let day = Date.UTC(first.y, first.m - 1, first.d); ; day += DAY_MS) {
    const date = new Date(day);
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + 1;
    const d = date.getUTCDate();
    const dayStart = zonedMidnight(y, m, d, timeZone);
    if (dayStart >= to) break;
    const weekday = date.getUTCDay(); // 0 Sunday, 6 Saturday — of the local calendar date
    if (weekday === 0 || weekday === 6) {
      const next = new Date(day + DAY_MS);
      const dayEnd = zonedMidnight(
        next.getUTCFullYear(),
        next.getUTCMonth() + 1,
        next.getUTCDate(),
        timeZone,
      );
      excluded += Math.max(0, Math.min(dayEnd, to) - Math.max(dayStart, from));
    }
  }
  return (to - from - excluded) / 3_600_000;
}
