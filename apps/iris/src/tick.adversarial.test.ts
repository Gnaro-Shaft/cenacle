// Iris's rhythm: she alerts only in the day, waits for the recap at night,
// sends each recap once, stops on /stop, retries when Telegram fails — and
// never puts anything but numbers in a message.
import type { NewEvent, StoredEvent } from "@cenacle/journal";
import { memoryMailStore } from "@cenacle/mail/test-helpers";
import { describe, expect, it } from "vitest";
import { recap, urgentAlert } from "./messages.ts";
import { type TickDeps, tick } from "./tick.ts";

const K = (c: string) => c.repeat(64);

function world(start: string) {
  let now = new Date(start);
  const events: StoredEvent[] = [];
  const sent: string[] = [];
  let telegramUp = true;
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
  let uid = 0;
  const receive = async (
    urgent: boolean,
    category: "clients_prospects" | "bruit" = "clients_prospects",
  ) => {
    uid++;
    await store.saveInbox("1", [
      {
        uid,
        receivedAt: now.toISOString(),
        noFollowUp: false,
        urgentTerm: urgent,
        senderAuthenticated: true,
        senderKey: K("a"),
        messageKey: K(String(uid % 10)),
        threadKeys: [],
      },
    ]);
    await store.categorize(uid, category, "rule");
  };
  const passes: Date[] = [];
  const deps: TickDeps = {
    now: () => now,
    startedAt: new Date(start),
    journal,
    store,
    events: async (agent) => events.filter((e) => e.agent === agent),
    runPass: async () => {
      passes.push(now);
      await journal.append({ agent: "iris", type: "mail.fetched", payload: { count: 0 } });
    },
    totals: async () => ({ waiting: 1, due: 2 }),
    send: async (text) => {
      if (!telegramUp) throw new Error("ECONNRESET api.telegram.org");
      sent.push(text);
    },
  };
  return {
    deps,
    events,
    sent,
    passes,
    receive,
    at: (iso: string) => {
      now = new Date(iso);
    },
    telegram: (up: boolean) => {
      telegramUp = up;
    },
  };
}

describe("Iris's rhythm", () => {
  it("collects every 15 minutes in the day, and not at night", async () => {
    const w = world("2026-10-01T10:00:00+02:00");
    await tick(w.deps);
    w.at("2026-10-01T10:10:00+02:00");
    await tick(w.deps);
    w.at("2026-10-01T10:15:00+02:00");
    await tick(w.deps);
    w.at("2026-10-01T22:00:00+02:00");
    await tick(w.deps);
    expect(w.passes.map((d) => d.toISOString())).toEqual([
      "2026-10-01T08:00:00.000Z",
      "2026-10-01T08:15:00.000Z",
    ]);
  });

  it("alerts at once about an urgent client mail in the day — numbers only, once", async () => {
    const w = world("2026-10-01T10:00:00+02:00");
    await w.receive(true);
    await w.receive(true, "bruit"); // a promotion shouting URGENT
    await tick(w.deps);
    w.at("2026-10-01T10:01:00+02:00");
    await tick(w.deps);
    expect(w.sent.filter((t) => t.startsWith("🚨"))).toEqual([urgentAlert(1)]);
  });

  it("an urgent mail of the night waits for the 9 h recap, and is not alerted at 8 h", async () => {
    const w = world("2026-10-01T22:30:00+02:00");
    await w.receive(true);
    await tick(w.deps);
    w.at("2026-10-02T08:05:00+02:00");
    await tick(w.deps);
    expect(w.sent).toEqual([]);
    w.at("2026-10-02T09:00:00+02:00");
    await tick(w.deps);
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]).toContain("🚨 1 mail client urgent pas encore signalé");
  });

  it("sends no recap in quiet hours, and skips yesterday's missed one", async () => {
    const w = world("2026-10-01T22:30:00+02:00");
    await tick(w.deps);
    w.at("2026-10-02T08:30:00+02:00");
    await tick(w.deps);
    expect(w.sent).toEqual([]);
  });

  it("sends each recap once", async () => {
    const w = world("2026-10-01T13:00:00+02:00");
    await tick(w.deps);
    w.at("2026-10-01T13:30:00+02:00");
    await tick(w.deps);
    expect(w.sent.filter((t) => t.startsWith("📬"))).toHaveLength(1);
    expect(w.sent[0]).toContain("récap de 13 h");
  });

  it("retries when Telegram is down, without losing the alert", async () => {
    const w = world("2026-10-01T10:00:00+02:00");
    await w.receive(true);
    w.telegram(false);
    await tick(w.deps);
    expect(w.events.some((e) => e.type === "notify.failed")).toBe(true);
    expect(JSON.stringify(w.events.map((e) => e.payload))).not.toMatch(/telegram\.org|ECONNRESET/);
    w.telegram(true);
    w.at("2026-10-01T10:01:00+02:00");
    await tick(w.deps);
    expect(w.sent.filter((t) => t.startsWith("🚨"))).toEqual([urgentAlert(1)]);
  });

  it("stops on /stop sent after it started, and does nothing more", async () => {
    const w = world("2026-10-01T10:00:00+02:00");
    w.at("2026-10-01T10:05:00+02:00");
    await w.deps.journal.append({ agent: "cenacle", type: "stop.requested" });
    await w.receive(true);
    expect(await tick(w.deps)).toBe("stopped");
    expect(w.sent).toEqual([]);
    expect(w.passes).toEqual([]);
  });
});

describe("drafting in the rhythm (phase 4)", () => {
  it("drafts after each collection; the recap gives only the number of drafts", async () => {
    const w = world("2026-10-01T08:58:00+02:00");
    const drafted: Date[] = [];
    const deps: TickDeps = {
      ...w.deps,
      draft: async () => {
        drafted.push(w.deps.now());
      },
      pendingDrafts: async () => 4,
    };
    await tick(deps);
    w.at("2026-10-01T09:01:00+02:00");
    await tick(deps);
    expect(drafted).toHaveLength(1);
    const recapText = w.sent.find((t) => t.startsWith("📬")) ?? "";
    expect(recapText).toContain("✏️ 4 brouillons à valider — sur la page");
  });

  it("a drafting failure is journaled and never stops the alerts", async () => {
    const w = world("2026-10-01T10:00:00+02:00");
    await w.receive(true);
    await tick({
      ...w.deps,
      draft: async () => {
        throw new TypeError("fetch failed: Claire Dubois <claire@client.example>");
      },
    });
    const failed = w.events.find((e) => e.type === "draft.failed");
    expect(failed?.payload).toEqual({ reason: "TypeError" });
    expect(w.sent).toContain(urgentAlert(1));
    expect(JSON.stringify(w.events.map((e) => e.payload))).not.toContain("claire");
  });
});

describe("messages — numbers and fixed words only", () => {
  it("never carry an address, a domain or free text", () => {
    const texts = [
      urgentAlert(1),
      urgentAlert(3),
      recap({
        hour: 9,
        fresh: { clients_prospects: 2, administratif: 1, bruit: 7, a_trier: 0, pending: 1 },
        due: 3,
        waiting: 2,
        urgent: 1,
        drafts: 2,
      }),
      recap({
        hour: 18,
        fresh: { clients_prospects: 0, administratif: 0, bruit: 0, a_trier: 0, pending: 0 },
        due: 0,
        waiting: 0,
        urgent: 0,
      }),
    ];
    for (const text of texts) expect(text).not.toMatch(/@|\.example|\.test|https?:/);
  });
});
