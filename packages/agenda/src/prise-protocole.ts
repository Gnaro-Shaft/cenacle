/**
 * What goes over the agenda's local socket (ADR-0042, point 7): one JSON
 * object per line, one request, one answer. The answer's schema is closed —
 * dates, hours "HH:MM", counts, account names and failure words — so that it
 * cannot carry a title: no field could hold one. Every line is checked on
 * both sides; anything else is refused, never guessed.
 *
 * This module imports nothing of the reader: the bot, which holds no
 * password, depends on it alone (with the client).
 */
import { join } from "node:path";

/** The longest request the server reads; the longest answer the client reads. */
export const MAX_REQUEST = 256;
export const MAX_ANSWER = 64 * 1024;
/** The hours shown for one day; beyond, only counted. */
export const MAX_HOURS_PER_DAY = 48;
/** The days an answer may hold (the week). */
export const MAX_ANSWER_DAYS = 7;
const MAX_ACCOUNTS = 8;
const MAX_COUNT = 1_000_000;

/** An account's name, as agenda.local.toml allows it. */
export const ACCOUNT_NAME_RULE = /^[a-z][a-z0-9_]{0,23}$/;

export type Ask = "tomorrow" | "week";

export type FailureWord = "refus" | "injoignable" | "delai" | "illisible" | "hote" | "config";
const FAILURE_WORDS: readonly FailureWord[] = [
  "refus",
  "injoignable",
  "delai",
  "illisible",
  "hote",
  "config",
];

export interface DayHours {
  /** "2026-11-18", Paris. */
  readonly date: string;
  /** Start times in Paris, sorted, at most MAX_HOURS_PER_DAY. */
  readonly hours: readonly string[];
  /** Timed events of the day beyond MAX_HOURS_PER_DAY. */
  readonly more: number;
  /** Whole-day events covering the day. */
  readonly wholeDays: number;
  /** Timed events begun before the day and still running at its midnight. */
  readonly ongoing: number;
}

export type HoursView =
  | { readonly read: "absent" }
  | { readonly read: "config" }
  | {
      readonly read: "ok";
      readonly days: readonly DayHours[];
      readonly failures: readonly { readonly account: string; readonly state: FailureWord }[];
      /** Events set aside over the window read (the page says why). */
      readonly setAside: number;
    };

export type SocketError = "busy" | "invalid" | "internal";
const SOCKET_ERRORS: readonly SocketError[] = ["busy", "invalid", "internal"];

export type SocketAnswer = HoursView | { readonly error: SocketError };

/** macOS caps a socket path at 104 bytes. */
const MAX_SOCKET_PATH = 103;

/** Beside the CTO's socket, in the same folder only I can open. */
export function agendaSocketPath(home: string): string {
  const path = join(home, "Library", "Application Support", "cenacle", "agenda.sock");
  if (Buffer.byteLength(path) > MAX_SOCKET_PATH) throw new Error("socket path too long");
  return path;
}

export function encodeLine(message: object, max: number): string {
  const line = JSON.stringify(message);
  if (Buffer.byteLength(line) > max) throw new Error("message too long");
  return `${line}\n`;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Exactly these keys, in any order. */
function hasKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value).sort();
  return own.length === keys.length && [...keys].sort().every((k, i) => own[i] === k);
}

/** The request: `{"ask":"tomorrow"}` or `{"ask":"week"}`, and nothing else. */
export function decodeAsk(line: string): Ask {
  const value: unknown = JSON.parse(line);
  if (!isObject(value) || !hasKeys(value, ["ask"])) throw new Error("invalid request");
  if (value.ask === "tomorrow" || value.ask === "week") return value.ask;
  throw new Error("invalid request");
}

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const HOUR = /^([01]\d|2[0-3]):[0-5]\d$/;

function count(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_COUNT) {
    throw new Error("invalid count");
  }
  return v;
}

function day(v: unknown): DayHours {
  if (!isObject(v) || !hasKeys(v, ["date", "hours", "more", "wholeDays", "ongoing"])) {
    throw new Error("invalid day");
  }
  if (typeof v.date !== "string" || !DATE.test(v.date)) throw new Error("invalid date");
  const hours = v.hours;
  if (!Array.isArray(hours) || hours.length > MAX_HOURS_PER_DAY) throw new Error("invalid hours");
  for (const h of hours) {
    if (typeof h !== "string" || !HOUR.test(h)) throw new Error("invalid hour");
  }
  return {
    date: v.date,
    hours: hours as string[],
    more: count(v.more),
    wholeDays: count(v.wholeDays),
    ongoing: count(v.ongoing),
  };
}

function failure(v: unknown): { account: string; state: FailureWord } {
  if (!isObject(v) || !hasKeys(v, ["account", "state"])) throw new Error("invalid failure");
  if (typeof v.account !== "string" || !ACCOUNT_NAME_RULE.test(v.account)) {
    throw new Error("invalid account");
  }
  if (!FAILURE_WORDS.includes(v.state as FailureWord)) throw new Error("invalid state");
  return { account: v.account, state: v.state as FailureWord };
}

/** An answer from the server, checked field by field. */
export function decodeAnswer(line: string): SocketAnswer {
  const value: unknown = JSON.parse(line);
  if (!isObject(value)) throw new Error("invalid answer");
  if (hasKeys(value, ["error"])) {
    if (SOCKET_ERRORS.includes(value.error as SocketError)) {
      return { error: value.error as SocketError };
    }
    throw new Error("invalid error");
  }
  if (hasKeys(value, ["read"]) && (value.read === "absent" || value.read === "config")) {
    return { read: value.read };
  }
  if (!hasKeys(value, ["read", "days", "failures", "setAside"]) || value.read !== "ok") {
    throw new Error("invalid answer");
  }
  const { days, failures } = value;
  if (!Array.isArray(days) || days.length < 1 || days.length > MAX_ANSWER_DAYS) {
    throw new Error("invalid days");
  }
  if (!Array.isArray(failures) || failures.length > MAX_ACCOUNTS) {
    throw new Error("invalid failures");
  }
  return {
    read: "ok",
    days: days.map(day),
    failures: failures.map(failure),
    setAside: count(value.setAside),
  };
}
