/**
 * One beat of Iris's rhythm (phase 3, S4), run every minute by main.ts.
 *
 * In order: honour an emergency stop; collect if 15 minutes have passed
 * (8 h–20 h on weekdays); outside quiet hours, alert about new urgent client
 * mails; send the recap of 9 h / 13 h / 18 h once. From phase 4, Iris also
 * drafts replies after each collection — only their number reaches Telegram. Everything she remembers
 * about her rhythm comes from the journal, so a restart loses nothing.
 * She never sends a mail: her only outward channel is Telegram, to me.
 */
import { collectDue, dayStart, isQuiet, recapToSend, TIME_ZONE, zonedParts } from "@cenacle/core";
import type { Journal, MailStore, StoredEvent } from "@cenacle/journal";
import { TelegramError } from "@cenacle/telegram/api";
import { type NewCounts, recap, urgentAlert } from "./messages.ts";

const AGENT = "iris";
const URGENT_WINDOW_MS = 24 * 3600 * 1000;
/** A recap sent later than this after its hour says so, with the time of its numbers. */
const LATE_RECAP_MS = 15 * 60 * 1000;

export interface TickDeps {
  readonly now: () => Date;
  readonly startedAt: Date;
  readonly journal: Journal;
  readonly store: MailStore;
  /** All journal events of an agent, oldest first. */
  readonly events: (agent: string) => Promise<readonly StoredEvent[]>;
  readonly runPass: () => Promise<void>;
  /** Totals with the follow-up counters (mailTotals). */
  readonly totals: (now: Date) => Promise<{ readonly waiting: number; readonly due: number }>;
  readonly send: (text: string) => Promise<void>;
  /** Phase 4, B3: drafts replies for the due follow-ups, after each collection. */
  readonly draft?: () => Promise<void>;
  /** Proposals waiting for me (only their number reaches Telegram). */
  readonly pendingDrafts?: () => Promise<number>;
  /** Phase 5, C1: applies the retentions of cadre.toml, once a day (purge.ts). */
  readonly purge?: () => Promise<void>;
  /** Phase 5, S2: tells the sentinel Iris is alive (never throws). */
  readonly heartbeat?: () => Promise<void>;
  /** One line when Telegram becomes unreachable, one when it is back. */
  readonly log?: (line: string) => void;
}

export type TickOutcome = "stopped" | "done";

function lastOf(events: readonly StoredEvent[], type: string): StoredEvent | undefined {
  return events.findLast((e) => e.type === type);
}

function localHour(at: Date): number {
  return zonedParts(at.getTime(), TIME_ZONE).h;
}

async function freshCounts(store: MailStore, since: Date): Promise<NewCounts> {
  const counts = { clients_prospects: 0, administratif: 0, bruit: 0, a_trier: 0, pending: 0 };
  for (const mail of await store.inbox()) {
    if (Date.parse(mail.receivedAt) > since.getTime()) counts[mail.category ?? "pending"]++;
  }
  return counts;
}

/** The start of the current Telegram outage, read from the journal (a restart loses nothing). */
async function outageSince(deps: TickDeps): Promise<StoredEvent | undefined> {
  const last = (await deps.events(AGENT)).findLast(
    (e) => e.type === "notify.failed" || e.type === "notify.recovered",
  );
  return last?.type === "notify.failed" ? last : undefined;
}

/**
 * Sends on Telegram. A Telegram failure is retried by the next beat, since
 * nothing is marked sent: journaled once per outage, by its kind only. Any
 * other error is a bug and throws (charter, rule 3).
 */
async function notify(
  deps: TickDeps,
  text: string,
  type: string,
  payload: Record<string, unknown>,
) {
  const outage = await outageSince(deps);
  try {
    await deps.send(text);
  } catch (error) {
    if (!(error instanceof TelegramError)) throw error;
    if (outage === undefined) {
      await deps.journal.append({
        agent: AGENT,
        type: "notify.failed",
        payload: { kind: type, failure: error.kind },
      });
      deps.log?.(`⚠ Telegram injoignable (${error.kind}) : messages retentés chaque minute`);
    }
    return false;
  }
  if (outage !== undefined) {
    const minutes = Math.round((deps.now().getTime() - outage.occurredAt.getTime()) / 60_000);
    await deps.journal.append({ agent: AGENT, type: "notify.recovered", payload: { minutes } });
    deps.log?.(`✔ Telegram de nouveau joint, après ${minutes} min`);
  }
  await deps.journal.append({ agent: AGENT, type, payload });
  return true;
}

export async function tick(deps: TickDeps): Promise<TickOutcome> {
  const stop = lastOf(await deps.events("cenacle"), "stop.requested");
  if (stop !== undefined && stop.occurredAt.getTime() > deps.startedAt.getTime()) return "stopped";
  await deps.heartbeat?.();
  if (deps.purge !== undefined) {
    try {
      await deps.purge();
    } catch {
      // Already journaled as purge.failed; alerts and recaps go on, the next beat retries.
    }
  }

  let events = await deps.events(AGENT);
  const lastFetch = lastOf(events, "mail.fetched");
  if (collectDue(deps.now(), lastFetch?.occurredAt ?? null)) {
    await deps.runPass();
    if (deps.draft !== undefined) {
      try {
        await deps.draft();
      } catch (error) {
        // Drafting is a help, not a duty: alerts and recaps go on without it.
        const reason = error instanceof Error ? error.name : "unknown";
        await deps.journal.append({ agent: AGENT, type: "draft.failed", payload: { reason } });
      }
    }
    events = await deps.events(AGENT);
  }

  const now = deps.now();
  if (!isQuiet(now)) {
    // Only what arrived since 8 h today: an urgent mail of the night waits for the recap.
    const urgent = await deps.store.urgentToNotify(dayStart(now));
    if (
      urgent.length > 0 &&
      (await notify(deps, urgentAlert(urgent.length), "alert.sent", {
        kind: "urgent",
        count: urgent.length,
      }))
    ) {
      await deps.store.markUrgentNotified(urgent);
    }
  }

  const lastRecap = lastOf(events, "recap.sent");
  const lastSlot =
    typeof lastRecap?.payload.slot === "string" ? new Date(lastRecap.payload.slot) : null;
  // A recap is a message on Iris's initiative: never in quiet hours.
  const slot = isQuiet(now) ? null : recapToSend(now, lastSlot);
  if (slot !== null) {
    const since = lastSlot ?? new Date(slot.getTime() - URGENT_WINDOW_MS);
    const fresh = await freshCounts(deps.store, since);
    const urgent = await deps.store.urgentToNotify(since);
    const { due, waiting } = await deps.totals(now);
    const drafts = (await deps.pendingDrafts?.()) ?? 0;
    const late = now.getTime() - slot.getTime() > LATE_RECAP_MS;
    const text = recap({
      hour: localHour(slot),
      fresh,
      due,
      waiting,
      urgent: urgent.length,
      drafts,
      ...(late ? { asOf: zonedParts(now.getTime(), TIME_ZONE) } : {}),
    });
    if (
      await notify(deps, text, "recap.sent", {
        slot: slot.toISOString(),
        due,
        waiting,
        urgent: urgent.length,
      })
    ) {
      await deps.store.markUrgentNotified(urgent);
    }
  }
  return "done";
}
