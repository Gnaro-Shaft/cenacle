/**
 * One beat of Iris's rhythm (phase 3, S4), run every minute by main.ts.
 *
 * In order: honour an emergency stop; collect if 15 minutes have passed
 * (8 h–20 h on weekdays); outside quiet hours, alert about new urgent client
 * mails; send the recap of 9 h / 13 h / 18 h once. Everything she remembers
 * about her rhythm comes from the journal, so a restart loses nothing.
 * She never sends a mail: her only outward channel is Telegram, to me.
 */
import { collectDue, dayStart, isQuiet, recapToSend, TIME_ZONE } from "@cenacle/core";
import type { Journal, MailStore, StoredEvent } from "@cenacle/journal";
import { type NewCounts, recap, urgentAlert } from "./messages.ts";

const AGENT = "iris";
const URGENT_WINDOW_MS = 24 * 3600 * 1000;

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
}

export type TickOutcome = "stopped" | "done";

function lastOf(events: readonly StoredEvent[], type: string): StoredEvent | undefined {
  return events.findLast((e) => e.type === type);
}

function localHour(at: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TIME_ZONE,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(at),
  );
}

async function freshCounts(store: MailStore, since: Date): Promise<NewCounts> {
  const counts = { clients_prospects: 0, administratif: 0, bruit: 0, a_trier: 0, pending: 0 };
  for (const mail of await store.inbox()) {
    if (Date.parse(mail.receivedAt) > since.getTime()) counts[mail.category ?? "pending"]++;
  }
  return counts;
}

async function notify(
  deps: TickDeps,
  text: string,
  type: string,
  payload: Record<string, unknown>,
) {
  try {
    await deps.send(text);
  } catch (error) {
    // The message may quote the network error, never mail content; the name is enough.
    const reason = error instanceof Error ? error.name : "unknown";
    await deps.journal.append({
      agent: AGENT,
      type: "notify.failed",
      payload: { kind: type, reason },
    });
    return false;
  }
  await deps.journal.append({ agent: AGENT, type, payload });
  return true;
}

export async function tick(deps: TickDeps): Promise<TickOutcome> {
  const stop = lastOf(await deps.events("cenacle"), "stop.requested");
  if (stop !== undefined && stop.occurredAt.getTime() > deps.startedAt.getTime()) return "stopped";

  let events = await deps.events(AGENT);
  const lastFetch = lastOf(events, "mail.fetched");
  if (collectDue(deps.now(), lastFetch?.occurredAt ?? null)) {
    await deps.runPass();
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
    const text = recap({ hour: localHour(slot), fresh, due, waiting, urgent: urgent.length });
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
