/**
 * When the security agent looks, and when it speaks (J6a, Legion's ronde).
 * A round every 15 minutes runs the local checks; the network ones (updates,
 * Tailscale, npm) at most once an hour. A new finding speaks at once when it
 * is serious — critical at any hour, high outside quiet hours (22 h - 7 h,
 * Paris) — and otherwise waits for the morning report, sent by the first
 * round after 7:30, once a day. Pure: every rule is testable.
 */
import { TIME_ZONE } from "@cenacle/core";
import type { Severity } from "./types.ts";

/** Local and instant: worth every round. */
export const LOCAL_CHECKS: readonly string[] = ["filevault", "firewall", "sip", "gatekeeper"];
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

export function isQuiet(now: Date): boolean {
  const { hour } = local(now);
  return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR;
}

/** A new finding of this severity speaks at once, now? */
export function urgentNow(severity: Severity, now: Date): boolean {
  if (severity === "critique") return true;
  return severity === "eleve" && !isQuiet(now);
}

/** The morning report: due from 7:30, once per local day. */
export function reportDue(now: Date, lastReport: Date | null): boolean {
  const t = local(now);
  const afterTime =
    t.hour > REPORT_AT.hour || (t.hour === REPORT_AT.hour && t.minute >= REPORT_AT.minute);
  if (!afterTime || t.hour >= QUIET_FROM_HOUR) return false;
  return lastReport === null || local(lastReport).day !== t.day;
}

/** The network checks: at most once an hour. */
export function networkDue(now: Date, lastNetwork: Date | null): boolean {
  return lastNetwork === null || now.getTime() - lastNetwork.getTime() >= NETWORK_EVERY_MS;
}
