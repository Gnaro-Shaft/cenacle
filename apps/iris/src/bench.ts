/**
 * The alert bench (phase 3, S5): replays the fictional mailbox over its
 * eleven days, minute by minute, through Iris's real rhythm (tick.ts), and
 * checks the exit criterion of phase 3:
 *   - no urgent client mail is missed — alerted within 16 minutes when it
 *     arrives in the day, otherwise in the next recap;
 *   - no alert too many — the promotion shouting URGENT and the trapped
 *     subject never trigger anything;
 *   - no mail content in any Telegram message;
 *   - each weekday recap (9 h, 13 h, 18 h) is sent once, and nothing in
 *     quiet hours.
 * The model is stood in for by the expected categories: only the rhythm is
 * measured here (sorting has its own bench, mail:bench).
 */
import { createHash } from "node:crypto";
import {
  hasUrgentTerm,
  isQuiet,
  loadFixtureMailbox,
  RECAP_HOURS,
  TIME_ZONE,
  zonedTime,
} from "@cenacle/core";
import type { NewEvent, StoredEvent } from "@cenacle/journal";
import { memoryMailStore } from "@cenacle/mail/test-helpers";
import { tick } from "./tick.ts";

const MINUTE = 60_000;
export const START = new Date("2026-09-21T00:00:00+02:00");
export const END = new Date("2026-10-02T00:00:00+02:00");

export interface Outage {
  readonly from: Date;
  readonly to: Date;
}

export interface Sent {
  readonly at: Date;
  readonly text: string;
}

export interface BenchReport {
  readonly urgentExpected: number;
  readonly urgentSignalled: number;
  readonly late: readonly string[];
  readonly missed: readonly string[];
  readonly extraUrgent: number;
  readonly leaks: readonly string[];
  readonly recaps: number;
  readonly recapsExpected: number;
  readonly quietMessages: number;
  readonly failures: readonly string[];
}

const key = (v: string) => createHash("sha256").update(v).digest("hex");

/** The first recap slot at or after `at` (weekdays). */
function nextRecap(at: Date): Date {
  for (let day = 0; day < 8; day++) {
    const d = new Date(at.getTime() + day * 24 * 3600 * 1000);
    const p = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(d)
      .split("-")
      .map(Number);
    const [y = 0, m = 0, dd = 0] = p;
    const weekday = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (const h of RECAP_HOURS) {
      const slot = zonedTime(y, m, dd, h, 0, TIME_ZONE);
      if (slot >= at.getTime()) return new Date(slot);
    }
  }
  throw new Error("no recap within a week");
}

/** By when an urgent mail must be signalled. */
export function deadline(arrival: Date): Date {
  const pass = new Date(arrival.getTime() + 15 * MINUTE);
  if (!isQuiet(arrival) && !isQuiet(pass)) return new Date(arrival.getTime() + 16 * MINUTE);
  return new Date(nextRecap(arrival).getTime() + MINUTE);
}

export async function runAlertBench(outages: readonly Outage[] = []): Promise<BenchReport> {
  const box = loadFixtureMailbox();
  const mails = [...box.messages].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const store = memoryMailStore();
  const events: StoredEvent[] = [];
  const sent: Sent[] = [];
  let now = START;
  let next = 0;
  const journal = {
    async append(e: NewEvent) {
      const stored = {
        id: BigInt(events.length + 1),
        occurredAt: now,
        agent: e.agent,
        type: e.type,
        payload: e.payload ?? {},
      };
      events.push(stored);
      return stored;
    },
    async read() {
      return [...events];
    },
  };
  const uidOf = new Map<number, string>();
  // When each urgent mail was signalled (alert or recap): recorded by the store itself.
  const markedAt = new Map<number, Date>();
  const markUrgentNotified = store.markUrgentNotified.bind(store);
  store.markUrgentNotified = async (uids) => {
    for (const uid of uids) if (!markedAt.has(uid)) markedAt.set(uid, now);
    await markUrgentNotified(uids);
  };

  for (let t = START.getTime(); t < END.getTime(); t += MINUTE) {
    now = new Date(t);
    await tick({
      now: () => now,
      startedAt: START,
      journal,
      store,
      events: async (agent) => events.filter((e) => e.agent === agent),
      runPass: async () => {
        while (next < mails.length && Date.parse(mails[next]?.date ?? "") <= now.getTime()) {
          const m = mails[next];
          next++;
          if (m === undefined) continue;
          const uid = next;
          uidOf.set(uid, m.id);
          await store.saveInbox("1", [
            {
              uid,
              receivedAt: new Date(m.date).toISOString(),
              noFollowUp: false,
              urgentTerm: hasUrgentTerm(m.subject),
              senderAuthenticated: true,
              senderKey: key(m.from.address),
              messageKey: key(m.id),
              threadKeys: [],
            },
          ]);
          await store.categorize(uid, m.expected.category, "rule");
        }
        await journal.append({ agent: "iris", type: "mail.fetched", payload: { count: 0 } });
      },
      totals: async () => ({ waiting: 0, due: 0 }),
      send: async (text) => {
        if (outages.some((o) => now >= o.from && now < o.to)) throw new Error("telegram down");
        sent.push({ at: now, text });
      },
    });
  }

  const urgentMails = mails.filter((m) => m.expected.urgent);
  const late: string[] = [];
  const missed: string[] = [];
  for (const m of urgentMails) {
    const arrival = new Date(m.date);
    const uid = [...uidOf.entries()].find(([, id]) => id === m.id)?.[0];
    const at = uid === undefined ? undefined : markedAt.get(uid);
    if (at === undefined) {
      missed.push(m.id);
      continue;
    }
    if (outages.length === 0 && at.getTime() > deadline(arrival).getTime()) {
      late.push(`${m.id} (${arrival.toISOString()} → ${at.toISOString()})`);
    }
  }
  const signalTimes = events.filter((e) => e.type === "alert.sent" || e.type === "recap.sent");
  const urgentSignalled = signalTimes.reduce(
    (n, e) => n + Number(e.payload.count ?? e.payload.urgent ?? 0),
    0,
  );

  const forbidden = mails.flatMap((m) => [
    m.from.address,
    m.from.address.split("@")[1] ?? "",
    m.subject,
    m.from.name,
  ]);
  const leaks = sent
    .filter(
      (s) => /@|https?:/.test(s.text) || forbidden.some((f) => f.length > 3 && s.text.includes(f)),
    )
    .map((s) => s.text);

  const recaps = sent.filter((s) => s.text.startsWith("📬")).length;
  let recapsExpected = 0;
  for (let t = START.getTime(); t < END.getTime(); t += 24 * 3600 * 1000) {
    const day = new Date(t + 12 * 3600 * 1000);
    if (!isQuiet(new Date(day.getTime()))) recapsExpected += RECAP_HOURS.length;
  }
  const quietMessages = sent.filter((s) => isQuiet(s.at)).length;

  const failures: string[] = [];
  if (missed.length > 0) failures.push(`${missed.length} urgent(s) manqué(s)`);
  if (late.length > 0) failures.push(`${late.length} urgent(s) en retard`);
  if (urgentSignalled !== urgentMails.length)
    failures.push(`${urgentSignalled} urgents signalés pour ${urgentMails.length} attendus`);
  if (leaks.length > 0) failures.push(`${leaks.length} message(s) avec du contenu`);
  if (recaps !== recapsExpected) failures.push(`${recaps} récaps pour ${recapsExpected} attendus`);
  if (quietMessages > 0) failures.push(`${quietMessages} message(s) en heures calmes`);
  return {
    urgentExpected: urgentMails.length,
    urgentSignalled,
    late,
    missed,
    extraUrgent: Math.max(0, urgentSignalled - urgentMails.length),
    leaks,
    recaps,
    recapsExpected,
    quietMessages,
    failures,
  };
}
