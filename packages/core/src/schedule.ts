/**
 * When Iris may act on her own (phase 3, S4 — validated 2026-10-03):
 * - she collects the mail every 15 minutes, 8 h–20 h, Monday to Friday;
 * - she sends a recap at 9 h, 13 h and 18 h on weekdays;
 * - she sends an immediate alert only outside quiet hours (20 h–8 h, weekends):
 *   an urgent mail arriving then waits for the next recap.
 * All times are Europe/Paris. Pure functions: the clock is always passed in.
 */
import { zonedParts, zonedTime } from "./working-hours.ts";

export const TIME_ZONE = "Europe/Paris";
export const COLLECT_EVERY_MINUTES = 15;
export const DAY_START_HOUR = 8;
export const DAY_END_HOUR = 20;
export const RECAP_HOURS = [9, 13, 18] as const;

function local(now: Date) {
  const p = zonedParts(now.getTime(), TIME_ZONE);
  // Weekday of the LOCAL calendar date (0 Sunday … 6 Saturday).
  const weekday = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return { ...p, weekday };
}

/** Evenings, nights and weekends: no message is sent on Iris's initiative. */
export function isQuiet(now: Date): boolean {
  const t = local(now);
  return t.weekday === 0 || t.weekday === 6 || t.h < DAY_START_HOUR || t.h >= DAY_END_HOUR;
}

/** 8 h today (local): urgent mails received before it wait for the recap. */
export function dayStart(now: Date): Date {
  const t = local(now);
  return new Date(zonedTime(t.y, t.m, t.d, DAY_START_HOUR, 0, TIME_ZONE));
}

/** Whether a collection pass is due now. */
export function collectDue(now: Date, lastCollectAt: Date | null): boolean {
  if (isQuiet(now)) return false;
  if (lastCollectAt === null) return true;
  return now.getTime() - lastCollectAt.getTime() >= COLLECT_EVERY_MINUTES * 60_000;
}

/** The latest recap slot that has started today (weekdays only), or null. */
export function latestRecapSlot(now: Date): Date | null {
  const t = local(now);
  if (t.weekday === 0 || t.weekday === 6) return null;
  let slot: number | null = null;
  for (const hour of RECAP_HOURS) {
    const at = zonedTime(t.y, t.m, t.d, hour, 0, TIME_ZONE);
    if (at <= now.getTime()) slot = at;
  }
  return slot === null ? null : new Date(slot);
}

/**
 * The recap to send now, if any: the latest slot of today not sent yet.
 * A missed slot (Mac asleep) is sent late, once; an older one is skipped.
 */
export function recapToSend(now: Date, lastSentSlot: Date | null): Date | null {
  const slot = latestRecapSlot(now);
  if (slot === null) return null;
  if (lastSentSlot !== null && lastSentSlot.getTime() >= slot.getTime()) return null;
  return slot;
}
