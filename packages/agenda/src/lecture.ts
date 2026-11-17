/**
 * One reading of the agenda (ADR-0042, points 1, 4 and 5): every declared
 * account, read in parallel at the moment of the call, each within its own
 * deadline; an account down is named with its word, the others are shown.
 * Nothing is kept: no database, no file, no cache — two calls at the same
 * moment share the reading under way, and nothing outlives it.
 *
 * The log says of a failed reading the account's name and one fixed word,
 * never a title, an hour, a login, an address nor a message of the server.
 */
import type { AgendaAccount, AgendaConfig } from "./config.ts";
import { type CalendarEvent, meetsWindow, type SetAsideReason } from "./ical.ts";
import { discover, type Failure, readCalendar, type Send } from "./releve.ts";
import { addDays, isoDate, localToInstant, MAX_DAYS, PARIS, windowOf } from "./times.ts";

export const ACCOUNT_DEADLINE_MS = 90_000;
const MAX_EVENTS_PER_ACCOUNT = 5000;

/** An account's state: read, or the word for its failure ("config": no password). */
export type AccountState = "ok" | Failure | "config";

export type AgendaEvent = CalendarEvent & { readonly account: string };

export type AgendaView =
  | { readonly read: "absent" }
  | { readonly read: "config"; readonly why: string }
  | {
      readonly read: "ok";
      /** The first day, Paris: "2026-11-17". */
      readonly from: string;
      readonly days: number;
      readonly accounts: readonly { readonly name: string; readonly state: AccountState }[];
      readonly events: readonly AgendaEvent[];
      readonly setAside: readonly {
        readonly account: string;
        readonly reason: SetAsideReason;
        readonly count: number;
      }[];
    };

export interface AgendaDeps {
  readonly config: () => AgendaConfig;
  /** How an account's requests go out, cut when the signal aborts. */
  readonly transport: (account: AgendaAccount, signal: AbortSignal) => Send;
  readonly now: () => number;
  readonly log: (line: string) => void;
  readonly accountDeadlineMs?: number;
}

interface AccountReading {
  readonly state: AccountState;
  readonly events: readonly CalendarEvent[];
  readonly setAside: ReadonlyMap<SetAsideReason, number>;
}

interface Bounds {
  readonly start: number;
  readonly end: number;
  readonly first: string;
  readonly last: string;
}

const failed = (state: AccountState): AccountReading => ({
  state,
  events: [],
  setAside: new Map(),
});

async function readAccount(
  deps: AgendaDeps,
  account: AgendaAccount,
  window: Bounds,
): Promise<AccountReading> {
  if (account.password === null) return failed("config");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.accountDeadlineMs ?? ACCOUNT_DEADLINE_MS);
  try {
    const send = deps.transport(account, controller.signal);
    const calendars = await discover(send, account.server, account.excluded);
    if (typeof calendars === "string") return failed(calendars);
    const events: CalendarEvent[] = [];
    const setAside = new Map<SetAsideReason, number>();
    for (const calendar of calendars) {
      const reads = await readCalendar(send, calendar, window.start, window.end);
      if (typeof reads === "string") return failed(reads);
      for (const r of reads) {
        if (!r.ok) setAside.set(r.reason, (setAside.get(r.reason) ?? 0) + 1);
        else if (meetsWindow(r.event, window) && events.length < MAX_EVENTS_PER_ACCOUNT) {
          events.push(r.event);
        }
      }
    }
    return { state: "ok", events, setAside };
  } catch {
    // A fault of ours: said as unreadable, its message never passed on.
    return failed(controller.signal.aborted ? "delai" : "illisible");
  } finally {
    clearTimeout(timer);
  }
}

/** Where an event sorts: a whole day just before the timed events of its first day. */
function sortAt(event: CalendarEvent, windowStart: number): number {
  if (event.kind === "heure") return event.start;
  const [y = 0, m = 1, d = 1] = event.first.split("-").map(Number);
  return Math.max(localToInstant({ y, m, d, h: 0, min: 0, s: 0 }, PARIS), windowStart) - 1;
}

async function readAll(deps: AgendaDeps, days: number): Promise<AgendaView> {
  const config = deps.config();
  if (config.read !== "ok") return config;
  const w = windowOf(deps.now(), days);
  const window: Bounds = {
    start: w.start,
    end: w.end,
    first: isoDate(w.from),
    last: isoDate(addDays(w.from, days - 1)),
  };
  const readings = await Promise.all(config.accounts.map((a) => readAccount(deps, a, window)));
  const accounts = config.accounts.map((a, i) => ({
    name: a.name,
    state: readings[i]?.state ?? "illisible",
  }));
  for (const a of accounts) {
    if (a.state !== "ok") deps.log(`agenda : ${a.name} ${a.state}`);
  }
  const events = config.accounts
    .flatMap((a, i) => (readings[i]?.events ?? []).map((e) => ({ ...e, account: a.name })))
    .sort((x, y) => sortAt(x, w.start) - sortAt(y, w.start));
  const setAside = config.accounts.flatMap((a, i) =>
    [...(readings[i]?.setAside ?? [])].map(([reason, count]) => ({
      account: a.name,
      reason,
      count,
    })),
  );
  return { read: "ok", from: window.first, days, accounts, events, setAside };
}

/** The reader: `days` from 1 to MAX_DAYS; one reading at a time per window, nothing kept. */
export function createAgenda(deps: AgendaDeps): (days: number) => Promise<AgendaView> {
  const under = new Map<number, Promise<AgendaView>>();
  return (days) => {
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
      return Promise.reject(new RangeError("days"));
    }
    const running = under.get(days);
    if (running !== undefined) return running;
    const reading = readAll(deps, days).finally(() => under.delete(days));
    under.set(days, reading);
    return reading;
  };
}
