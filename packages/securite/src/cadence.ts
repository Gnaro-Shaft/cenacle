/**
 * When the security agent looks, and when it speaks (J6a, Legion's ronde).
 * A round every 15 minutes runs the local checks; the network ones (updates,
 * Tailscale, npm) at most once an hour. A new finding speaks at once when it
 * is serious — critical at any hour, high once the day's morning report has
 * gone (so what the night found leaves with the report: one message in the
 * morning, revised on 2026-10-11) — and otherwise waits for the morning
 * report, sent by the first round after 7:30, once a day. Pure: every rule
 * is testable.
 */
import { TIME_ZONE } from "@cenacle/core";
import type { Severity } from "./types.ts";

/** Local and instant: worth every round. */
export const LOCAL_CHECKS: readonly string[] = [
  "filevault",
  "firewall",
  "sip",
  "gatekeeper",
  // Legion's verdict, a file on the Mac refreshed every 15 minutes (the bridge).
  "legion_ronde",
];
export const NETWORK_EVERY_MS = 3_600_000;
export const QUIET_FROM_HOUR = 22;
export const QUIET_UNTIL_HOUR = 7;
export const REPORT_AT = { hour: 7, minute: 30 } as const;

function local(now: Date): { day: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

/** The local day (Paris), YYYY-MM-DD. */
export function localDay(now: Date): string {
  return local(now).day;
}

export function isQuiet(now: Date): boolean {
  const { hour } = local(now);
  return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR;
}

/** The morning report has gone today (local day). */
export function reportSentToday(now: Date, lastReport: Date | null): boolean {
  return lastReport !== null && local(lastReport).day === local(now).day;
}

/**
 * A new finding of this severity speaks at once, now? Critical: always.
 * High: outside quiet hours, and only once today's report has gone — before
 * it, it waits for the report.
 */
export function urgentNow(severity: Severity, now: Date, lastReport: Date | null): boolean {
  if (severity === "critique") return true;
  return severity === "eleve" && !isQuiet(now) && reportSentToday(now, lastReport);
}

/** Findings that never speak at once, whatever their severity: my other projects' dependencies (J6e2). */
export const REPORT_ONLY_TYPES: readonly string[] = ["projet_npm"];

/** urgentNow, unless the kind of finding always waits for the morning report. */
export function speaksAtOnce(
  f: { readonly type: string; readonly severity: Severity },
  now: Date,
  lastReport: Date | null,
): boolean {
  return !REPORT_ONLY_TYPES.includes(f.type) && urgentNow(f.severity, now, lastReport);
}

/** Due from this local time until the quiet hours, once per local day. */
export function dueOnceADay(
  at: { readonly hour: number; readonly minute: number },
  now: Date,
  last: Date | null,
): boolean {
  const t = local(now);
  const afterTime = t.hour > at.hour || (t.hour === at.hour && t.minute >= at.minute);
  if (!afterTime || t.hour >= QUIET_FROM_HOUR) return false;
  return last === null || local(last).day !== t.day;
}

/** The morning report: due from 7:30, once per local day. */
export function reportDue(now: Date, lastReport: Date | null): boolean {
  return dueOnceADay(REPORT_AT, now, lastReport);
}

/** The network checks: at most once an hour. */
export function networkDue(now: Date, lastNetwork: Date | null): boolean {
  return lastNetwork === null || now.getTime() - lastNetwork.getTime() >= NETWORK_EVERY_MS;
}
