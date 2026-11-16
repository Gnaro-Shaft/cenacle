// The reminders on Telegram (ADR-0041): what the commands ask, what is said
// back — never « set » when the database said no — and the bell: ring, then
// confirm. A send that fails leaves the reminder due; a mark that fails makes
// it ring twice, never lost. The purge erases only what rang, and says how many.
import type { Rappel, RappelStore } from "@cenacle/journal";
import { describe, expect, it } from "vitest";
import { handleUpdate } from "./handler.ts";
import {
  LISTED,
  NOT_SET_UP,
  performReminder,
  purgeRang,
  RULE,
  reminderActions,
  ringDue,
} from "./rappels-bot.ts";

const CHAT = 111222333;
const NOW = new Date("2026-11-16T09:00:00Z");

function memoryStore(over: Partial<RappelStore> = {}) {
  const rows: Rappel[] = [];
  let next = 1;
  const store: RappelStore = {
    add: async (text, due) => {
      const r = { id: next++, text, due, setAt: NOW, rangAt: null };
      rows.push(r);
      return r;
    },
    upcoming: async (limit) => rows.filter((r) => r.rangAt === null).slice(0, limit),
    cancel: async (id) => {
      const i = rows.findIndex((r) => r.id === id && r.rangAt === null);
      if (i < 0) return false;
      rows.splice(i, 1);
      return true;
    },
    due: async (now, limit) =>
      rows.filter((r) => r.rangAt === null && r.due <= now).slice(0, limit),
    markRang: async (id, at) => {
      const r = rows.find((x) => x.id === id && x.rangAt === null);
      if (r === undefined) return false;
      rows[rows.indexOf(r)] = { ...r, rangAt: at };
      return true;
    },
    purge: async (cutoff) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) {
        const at = rows[i]?.rangAt;
        if (at != null && at < cutoff) rows.splice(i, 1);
      }
      return before - rows.length;
    },
    ...over,
  };
  return { store, rows };
}

const quiet = () => {};

describe("what the commands ask", () => {
  it("/rappel with when and text: one reminder to set", () => {
    expect(reminderActions("/rappel", "demain 09:00 appeler le garage", CHAT, NOW)).toEqual([
      {
        kind: "rappel_poser",
        chatId: CHAT,
        due: new Date("2026-11-17T08:00:00Z"),
        text: "appeler le garage",
      },
    ]);
  });

  it.each([
    ["nothing at all", "", /Pose un rappel ainsi/],
    ["a when it cannot read", "lundi 09:00 x", /quand \?/],
    ["a when without text", "demain 09:00", /vide/],
    ["a text on two lines", "demain 09:00 a\nb", /une ligne/],
    ["a text too long", `demain 09:00 ${"x".repeat(301)}`, /300 caractères/],
    ["an hour skipped by the change of time", "2027-03-28 02:30 x", /n'existe pas/],
  ])("/rappel with %s: said why, nothing set", (_what, rest, said) => {
    const actions = reminderActions("/rappel", rest, CHAT, NOW);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "reply", chatId: CHAT });
    expect((actions[0] as { text: string }).text).toMatch(said);
  });

  it("/annuler takes a number, or n°12; anything else is said", () => {
    expect(reminderActions("/annuler", "12", CHAT, NOW)).toEqual([
      { kind: "rappel_annuler", chatId: CHAT, id: 12 },
    ]);
    expect(reminderActions("/annuler", "n° 7", CHAT, NOW)[0]).toMatchObject({ id: 7 });
    for (const rest of ["", "0", "-1", "douze", "1 2", "99999999999999999"]) {
      expect(reminderActions("/annuler", rest, CHAT, NOW)[0]).toMatchObject({ kind: "reply" });
    }
  });

  it("only my conversation is heard: a stranger's /rappel is silence", async () => {
    const update = {
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 999, type: "private" },
        from: { id: 999 },
        text: "/rappel demain 09:00 x",
      },
    };
    const actions = await handleUpdate(update, {
      allowedChatId: CHAT,
      readStatus: async () => {
        throw new Error("unused");
      },
    });
    expect(actions).toEqual([
      { kind: "journal", type: "telegram.rejected", reason: "not_the_owner" },
    ]);
  });
});

describe("what is said back", () => {
  const said = () => {
    const out: string[] = [];
    return { out, reply: async (_chat: number, text: string) => void out.push(text) };
  };
  const deps = (store: RappelStore | null, reply: (c: number, t: string) => Promise<void>) => ({
    store,
    reply,
    now: () => NOW,
    log: quiet,
  });

  it("set: its number, its instant read back, its text, and the rule", async () => {
    const { store } = memoryStore();
    const { out, reply } = said();
    await performReminder(
      { kind: "rappel_poser", chatId: CHAT, due: new Date("2026-11-20T08:00:00Z"), text: "x" },
      deps(store, reply),
    );
    expect(out[0]).toBe(`🔔 Rappel n°1 : vendredi 20/11 à 09:00.\n« x »\n${RULE}`);
  });

  it("no retention in the cadre: nothing kept, said so", async () => {
    const { out, reply } = said();
    await performReminder({ kind: "rappels_lister", chatId: CHAT }, deps(null, reply));
    expect(out).toEqual([NOT_SET_UP]);
  });

  it("the database away: « NOT set », never « set », never its address", async () => {
    const { store } = memoryStore({
      add: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
      },
    });
    const { out, reply } = said();
    await performReminder(
      { kind: "rappel_poser", chatId: CHAT, due: new Date("2026-11-20T08:00:00Z"), text: "x" },
      deps(store, reply),
    );
    expect(out[0]).toMatch(/NON posé/);
    expect(out[0]).not.toMatch(/127\.0\.0\.1|5432/);
  });

  it("the list: soonest first, each text cut at 80, at most 20, under Telegram's limit", async () => {
    const { store } = memoryStore();
    for (let i = 0; i < 25; i++) {
      await store.add(`${i} ${"y".repeat(200)}`, new Date(NOW.getTime() + (i + 1) * 60_000));
    }
    const { out, reply } = said();
    await performReminder({ kind: "rappels_lister", chatId: CHAT }, deps(store, reply));
    const lines = (out[0] ?? "").split("\n");
    expect(lines[0]).toBe(`🔔 Les ${LISTED} prochains rappels à venir :`);
    expect(lines).toHaveLength(LISTED + 1);
    expect(lines[1]).toMatch(/^n°1 — lundi 16\/11 à 10:01 — 0 y+…$/);
    expect((out[0] ?? "").length).toBeLessThan(4096);
  });

  it("cancel: erased, then said unknown", async () => {
    const { store, rows } = memoryStore();
    await store.add("x", new Date("2026-11-20T08:00:00Z"));
    const { out, reply } = said();
    await performReminder({ kind: "rappel_annuler", chatId: CHAT, id: 1 }, deps(store, reply));
    await performReminder({ kind: "rappel_annuler", chatId: CHAT, id: 1 }, deps(store, reply));
    expect(out).toEqual([
      "🗑 Rappel n°1 annulé et effacé.",
      "Aucun rappel n°1 à venir (déjà sonné, annulé, ou inconnu).",
    ]);
    expect(rows).toEqual([]);
  });
});

describe("the bell: ring, then confirm", () => {
  it("each due one sent, then marked rung, in that order; one not due waits", async () => {
    const { store, rows } = memoryStore();
    await store.add("a", new Date("2026-11-16T08:59:00Z"));
    await store.add("b", new Date("2026-11-16T09:30:00Z"));
    const sent: string[] = [];
    const marked: number[] = [];
    const watched: RappelStore = {
      ...store,
      markRang: async (id, at) => {
        marked.push(id);
        return store.markRang(id, at);
      },
    };
    const ring = await ringDue({
      store: watched,
      send: async (text) => {
        expect(marked).toEqual([]);
        sent.push(text);
      },
      now: () => NOW,
      log: quiet,
    });
    expect(ring).toEqual({ rang: 1, failed: 0 });
    expect(sent).toEqual(["🔔 Rappel n°1 — a"]);
    expect(marked).toEqual([1]);
    expect(rows.find((r) => r.id === 2)?.rangAt).toBeNull();
  });

  it("Telegram away: nothing marked, everything still due, said once", async () => {
    const { store, rows } = memoryStore();
    await store.add("a", new Date("2026-11-16T08:00:00Z"));
    await store.add("b", new Date("2026-11-16T08:30:00Z"));
    const logs: string[] = [];
    const ring = await ringDue({
      store,
      send: async () => {
        throw new Error("network");
      },
      now: () => NOW,
      log: (l) => logs.push(l),
    });
    expect(ring).toEqual({ rang: 0, failed: 2 });
    expect(rows.every((r) => r.rangAt === null)).toBe(true);
    expect(logs).toHaveLength(1);
  });

  it("sent but the mark fails: it rings again next pass — twice, never lost", async () => {
    const { store, rows } = memoryStore();
    await store.add("a", new Date("2026-11-16T08:00:00Z"));
    const failing: RappelStore = {
      ...store,
      markRang: async () => {
        throw new Error("database away");
      },
    };
    const sent: string[] = [];
    const deps = {
      store: failing,
      send: async (t: string) => void sent.push(t),
      now: () => NOW,
      log: quiet,
    };
    await expect(ringDue(deps)).rejects.toThrow();
    await expect(ringDue(deps)).rejects.toThrow();
    expect(sent).toHaveLength(2);
    expect(rows[0]?.rangAt).toBeNull();
  });

  it("late (the Mac asleep): it says when it was due", async () => {
    const { store } = memoryStore();
    await store.add("a", new Date("2026-11-16T07:00:00Z"));
    const sent: string[] = [];
    await ringDue({ store, send: async (t) => void sent.push(t), now: () => NOW, log: quiet });
    expect(sent).toEqual(["🔔 Rappel n°1 — a\n(prévu lundi 16/11 à 08:00)"]);
  });
});

describe("the purge", () => {
  it("only what rang more than the retention ago; the trace says how many, never which", async () => {
    const { store, rows } = memoryStore();
    for (const [text, due] of [
      ["old", "2026-08-01T08:00:00Z"],
      ["recent", "2026-11-01T08:00:00Z"],
      ["to come", "2026-12-01T08:00:00Z"],
    ] as const) {
      await store.add(text, new Date(due));
    }
    await store.markRang(1, new Date("2026-08-01T08:00:00Z"));
    await store.markRang(2, new Date("2026-11-01T08:00:00Z"));
    const traces: unknown[] = [];
    const count = await purgeRang({
      store,
      retentionDays: 90,
      now: () => NOW,
      record: async (p) => void traces.push(p),
    });
    expect(count).toBe(1);
    expect(rows.map((r) => r.text)).toEqual(["recent", "to come"]);
    expect(traces).toEqual([{ count: 1, before: "2026-08-18T09:00:00.000Z" }]);
    expect(JSON.stringify(traces)).not.toContain("old");
  });

  it("nothing to erase: no trace at all", async () => {
    const { store } = memoryStore();
    const traces: unknown[] = [];
    await purgeRang({
      store,
      retentionDays: 90,
      now: () => NOW,
      record: async (p) => void traces.push(p),
    });
    expect(traces).toEqual([]);
  });
});

describe("what the review asked (P1)", () => {
  it("one message Telegram rejects: it stays due, the others still go", async () => {
    const { TelegramError } = await import("./api.ts");
    const { store, rows } = memoryStore();
    await store.add("refusé", new Date("2026-11-16T08:00:00Z"));
    await store.add("b", new Date("2026-11-16T08:30:00Z"));
    const sent: string[] = [];
    const ring = await ringDue({
      store,
      send: async (text) => {
        if (text.includes("refusé")) throw new TelegramError("Bad Request", "rejected");
        sent.push(text);
      },
      now: () => NOW,
      log: quiet,
    });
    expect(ring).toEqual({ rang: 1, failed: 1 });
    expect(sent).toHaveLength(1);
    expect(rows.find((r) => r.id === 1)?.rangAt).toBeNull();
    expect(rows.find((r) => r.id === 2)?.rangAt).not.toBeNull();
  });

  it("Telegram away (network): the pass stops, nothing else is tried", async () => {
    const { TelegramError } = await import("./api.ts");
    const { store } = memoryStore();
    await store.add("a", new Date("2026-11-16T08:00:00Z"));
    await store.add("b", new Date("2026-11-16T08:30:00Z"));
    let tries = 0;
    const logs: string[] = [];
    await ringDue({
      store,
      send: async () => {
        tries++;
        throw new TelegramError("down", "network");
      },
      now: () => NOW,
      log: (l) => logs.push(l),
    });
    expect(tries).toBe(1);
    expect(logs[0]).toMatch(/\(network\)/);
  });
});
