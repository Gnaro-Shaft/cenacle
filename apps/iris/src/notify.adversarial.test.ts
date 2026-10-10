// Iris's messages when Telegram is away: retried each minute as before, but
// journaled once per outage (not once a minute), by the failure's kind only;
// one console line each way; a late recap says so; and a bug in sending is
// no Telegram outage — it throws instead of being swallowed.
import type { NewEvent, StoredEvent } from "@cenacle/journal";
import { memoryMailStore } from "@cenacle/mail/test-helpers";
import { TelegramError } from "@cenacle/telegram/api";
import { describe, expect, it } from "vitest";
import { urgentAlert } from "./messages.ts";
import { type TickDeps, tick } from "./tick.ts";

const SECRET_PART = "AAHfake_token_for_tests_only_000000000";

function world(start: string, events: StoredEvent[] = []) {
  let now = new Date(start);
  const sent: string[] = [];
  const logs: string[] = [];
  let failure: Error | null = null;
  const store = memoryMailStore();
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
  const deps: TickDeps = {
    now: () => now,
    startedAt: new Date(start),
    journal,
    store,
    events: async (agent) => events.filter((e) => e.agent === agent),
    runPass: async () => {
      await journal.append({ agent: "iris", type: "mail.fetched", payload: { count: 0 } });
    },
    totals: async () => ({ waiting: 0, due: 0 }),
    send: async (text) => {
      if (failure !== null) throw failure;
      sent.push(text);
    },
    log: (l) => logs.push(l),
  };
  const receiveUrgent = async (uid: number) => {
    await store.saveInbox("1", [
      {
        uid,
        receivedAt: now.toISOString(),
        noFollowUp: false,
        urgentTerm: true,
        senderAuthenticated: true,
        senderKey: "a".repeat(64),
        messageKey: String(uid).repeat(64).slice(0, 64),
        threadKeys: [],
      },
    ]);
    await store.categorize(uid, "clients_prospects", "rule");
  };
  /** One beat per minute, from the current time, `n` times. */
  const beats = async (n: number) => {
    for (let i = 0; i < n; i++) {
      await tick(deps);
      now = new Date(now.getTime() + 60_000);
    }
  };
  return {
    deps,
    events,
    sent,
    logs,
    receiveUrgent,
    beats,
    at: (iso: string) => {
      now = new Date(iso);
    },
    fail: (e: Error | null) => {
      failure = e;
    },
  };
}
const cut = () =>
  new TelegramError(`Telegram unreachable (sendMessage): bot123456789:${SECRET_PART}`, "network");
const ofType = (events: StoredEvent[], type: string) => events.filter((e) => e.type === type);

describe("Iris's messages when Telegram is away", () => {
  it("a 30-minute cut: one notify.failed, one notify.recovered, the alert sent once at the return", async () => {
    const w = world("2026-10-01T10:00:00+02:00");
    await w.receiveUrgent(1);
    w.fail(cut());
    await w.beats(30);
    expect(w.sent).toEqual([]);
    expect(ofType(w.events, "notify.failed")).toHaveLength(1);
    expect(ofType(w.events, "notify.failed")[0]?.payload).toEqual({
      kind: "alert.sent",
      failure: "network",
    });
    w.fail(null);
    await w.beats(3);
    expect(w.sent.filter((t) => t.startsWith("🚨"))).toEqual([urgentAlert(1)]);
    expect(ofType(w.events, "notify.recovered").map((e) => e.payload)).toEqual([{ minutes: 30 }]);
    expect(w.logs).toEqual([
      "⚠ Telegram injoignable (network) : messages retentés chaque minute",
      "✔ Telegram de nouveau joint, après 30 min",
    ]);
  });

  it("the alert and the recap share one outage, and both leave at the return", async () => {
    const w = world("2026-10-01T12:50:00+02:00");
    await w.receiveUrgent(1);
    w.fail(cut());
    await w.beats(20); // 12:50 → 13:09: the 13 h recap is due meanwhile
    expect(ofType(w.events, "notify.failed")).toHaveLength(1);
    w.fail(null);
    await w.beats(2);
    expect(w.sent.filter((t) => t.startsWith("🚨"))).toHaveLength(1);
    expect(w.sent.filter((t) => t.startsWith("📬"))).toHaveLength(1);
    expect(ofType(w.events, "recap.sent")).toHaveLength(1);
  });

  it("Iris restarted in the middle of an outage writes no second notify.failed", async () => {
    const events: StoredEvent[] = [];
    const first = world("2026-10-01T10:00:00+02:00", events);
    await first.receiveUrgent(1);
    first.fail(cut());
    await first.beats(5);
    const second = world("2026-10-01T10:05:00+02:00", events);
    await second.receiveUrgent(1);
    second.fail(cut());
    await second.beats(5);
    expect(ofType(events, "notify.failed")).toHaveLength(1);
    expect(second.logs).toEqual([]);
    second.fail(null);
    await second.beats(1);
    expect(ofType(events, "notify.recovered").map((e) => e.payload)).toEqual([{ minutes: 10 }]);
  });

  it("the journal and the console never hold the error's text nor the token", async () => {
    const w = world("2026-10-01T10:00:00+02:00");
    await w.receiveUrgent(1);
    w.fail(cut());
    await w.beats(2);
    w.fail(null);
    await w.beats(1);
    const all = JSON.stringify(w.events.map((e) => e.payload)) + w.logs.join("\n");
    expect(all).not.toContain(SECRET_PART);
    expect(all).not.toMatch(/unreachable|sendMessage|bot123/);
  });

  it("a bug in sending is no outage: it throws, and nothing is journaled as failed", async () => {
    const w = world("2026-10-01T10:00:00+02:00");
    await w.receiveUrgent(1);
    w.fail(new RangeError("bug"));
    await expect(tick(w.deps)).rejects.toBeInstanceOf(RangeError);
    expect(ofType(w.events, "notify.failed")).toEqual([]);
  });
});

describe("a late recap says so", () => {
  it("over 15 minutes late: the mention, with the time of its numbers", async () => {
    const w = world("2026-10-01T12:59:00+02:00");
    w.fail(cut());
    await w.beats(2); // 12:59, 13:00
    w.at("2026-10-01T16:05:00+02:00");
    w.fail(null);
    await w.beats(1);
    expect(w.sent[0]?.split("\n")[0]).toBe(
      "📬 Iris — récap de 13 h (envoyé en retard, chiffres de 16 h 05)",
    );
  });

  it("15 minutes late or less: no mention", async () => {
    const w = world("2026-10-01T13:00:00+02:00");
    w.fail(cut());
    await w.beats(15); // 13:00 → 13:14
    w.fail(null);
    await w.beats(2); // 13:15 sends it
    expect(w.sent[0]?.split("\n")[0]).toBe("📬 Iris — récap de 13 h");
  });
});
