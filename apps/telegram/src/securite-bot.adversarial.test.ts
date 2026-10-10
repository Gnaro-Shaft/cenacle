// The security buttons on the bot's side (J6b): only the owner in the private
// chat is heard; a strange button is refused; the decision is written before
// any answer, so a failing edit loses nothing; a reason is taken only as a
// reply to the bot's question; /constats lists what is still to fix with its
// buttons; the journal gets the kind of decision only.
import type { NewEvent, SecuriteDecisions, StoredFinding } from "@cenacle/journal";
import { describe, expect, it } from "vitest";
import type { InlineButton, TelegramCallback, TelegramMessage } from "./api.ts";
import {
  handleCallback,
  handleReasonReply,
  listFindings,
  type SecuriteBotDeps,
} from "./securite-bot.ts";

const OWNER = 4242;
// A fake button token, built by pieces (not a secret: a test value).
const TOKEN = ["01234567", "89abcdef"].join("");
const NOW = new Date("2026-10-11T08:00:00Z");

function world(over: Partial<SecuriteDecisions> = {}) {
  const calls: string[] = [];
  const events: NewEvent[] = [];
  let edits = 0;
  let failEdit = false;
  const decisions: SecuriteDecisions = {
    tokens: async (ids) => new Map(ids.map((id) => [id, TOKEN])),
    check: async (_id, token) => (token === TOKEN ? "done" : "stale"),
    decide: async (id, token, decision) => {
      calls.push(`decide ${id} ${decision}`);
      return token === TOKEN ? "done" : "stale";
    },
    askReason: async (prompt, id) => {
      calls.push(`ask ${prompt} ${id}`);
    },
    giveReason: async (prompt, reason) => {
      calls.push(`reason ${prompt} ${reason}`);
      return prompt === 77 ? "done" : "unknown";
    },
    isAsking: async (prompt) => prompt === 77 || prompt === 78,
    purge: async () => 0,
    ...over,
  };
  const deps: SecuriteBotDeps = {
    allowedChatId: OWNER,
    api: {
      sendMessage: async (_c, text) => {
        calls.push(`send ${text}`);
      },
      sendWithButtons: async (_c, text, rows) => {
        calls.push(`buttons ${rows.length} ${text.split("\n")[0]}`);
        return 1;
      },
      askReply: async (_c, text) => {
        calls.push(`askReply ${text.slice(0, 20)}`);
        return 77;
      },
      answerCallback: async (_id, text) => {
        calls.push(`answer ${text}`);
      },
      editButtons: async (_c, _m, rows) => {
        if (failEdit) throw new Error("Telegram edit failed");
        edits += 1;
        calls.push(`edit ${rows.length}`);
      },
    },
    store: { open: async () => [] },
    decisions,
    journal: {
      append: async (e) => {
        events.push(e);
        return { id: 1n, occurredAt: NOW, agent: e.agent, type: e.type, payload: e.payload ?? {} };
      },
    },
    now: () => NOW,
  };
  return { deps, calls, events, edits: () => edits, failEdits: () => (failEdit = true) };
}

const rows: InlineButton[][] = [
  [{ text: "✅", callback_data: `s:1:t:${TOKEN}` }],
  [{ text: "✅", callback_data: `s:2:t:${TOKEN}` }],
];
const tap = (
  data: string,
  from = OWNER,
  chat = { id: OWNER, type: "private" },
): TelegramCallback => ({
  id: "cb1",
  from: { id: from },
  data,
  message: { message_id: 10, chat, reply_markup: { inline_keyboard: rows } },
});

describe("a tap on a button", () => {
  it("✅ from me: decided, answered, and only its row removed", async () => {
    const w = world();
    await handleCallback(tap(`s:1:t:${TOKEN}`), w.deps);
    expect(w.calls).toEqual([
      "decide 1 take",
      expect.stringMatching(/^answer ✅ Constat n°1 pris en charge/),
      "edit 1",
    ]);
    expect(w.events.map((e) => [e.type, e.payload])).toEqual([
      ["securite.decided", { action: "take" }],
    ]);
  });

  it.each([
    ["another account", tap(`s:1:t:${TOKEN}`, 666)],
    ["a group", tap(`s:1:t:${TOKEN}`, OWNER, { id: OWNER, type: "group" })],
    ["another chat", tap(`s:1:t:${TOKEN}`, OWNER, { id: 666, type: "private" })],
  ])("from %s: ignored, nothing decided, journaled without who", async (_, cb) => {
    const w = world();
    await handleCallback(cb, w.deps);
    expect(w.calls).toEqual([]);
    expect(w.events).toEqual([
      { agent: "cenacle", type: "telegram.rejected", payload: { reason: "not_the_owner" } },
    ]);
  });

  it("a strange or forged button: refused, nothing decided", async () => {
    const w = world();
    await handleCallback(tap("s:1:t:'; drop table x"), w.deps);
    await handleCallback(tap(`s:1:t:${"f".repeat(16)}`), w.deps);
    expect(w.calls.filter((c) => c.startsWith("answer"))).toHaveLength(2);
    expect(w.calls.filter((c) => c.startsWith("edit"))).toEqual([]);
    expect(w.events).toEqual([]);
  });

  it("a failing edit loses nothing: the decision was written first", async () => {
    const w = world();
    w.failEdits();
    await handleCallback(tap(`s:2:r:${TOKEN}`), w.deps);
    expect(w.calls[0]).toBe("decide 2 refuse");
    expect(w.events.map((e) => e.payload)).toEqual([{ action: "refuse" }]);
  });

  it("☑: the question is asked as a reply, and its deadline written", async () => {
    const w = world();
    await handleCallback(tap(`s:1:k:${TOKEN}`), w.deps);
    expect(w.calls).toEqual([
      expect.stringMatching(/^askReply ☑ Pourquoi/),
      "ask 77 1",
      "answer ☑ J'attends la raison.",
    ]);
    expect(w.events).toEqual([]);
  });
});

const reply = (text: string, to: number | undefined, from = OWNER): TelegramMessage => ({
  message_id: 90,
  chat: { id: OWNER, type: "private" },
  from: { id: from },
  text,
  ...(to === undefined ? {} : { reply_to_message: { message_id: to } }),
});

describe("the reason", () => {
  it("a reply to the question: the risk is kept, journaled by its kind", async () => {
    const w = world();
    expect(await handleReasonReply(reply("mise à jour vendredi", 77), w.deps)).toBe(true);
    expect(w.calls).toEqual([
      "reason 77 mise à jour vendredi",
      expect.stringMatching(/^send ☑ Risque gardé/),
    ]);
    expect(w.events.map((e) => e.payload)).toEqual([{ action: "keep" }]);
  });

  it("not a reply, a reply to something else, or someone else: not a reason", async () => {
    const w = world();
    expect(await handleReasonReply(reply("raison", undefined), w.deps)).toBe(false);
    expect(await handleReasonReply(reply("raison", 5), w.deps)).toBe(false);
    expect(await handleReasonReply(reply("raison", 77, 666), w.deps)).toBe(false);
    expect(w.calls).toEqual([]);
  });

  it("too short, or /annuler: said, nothing kept", async () => {
    const w = world();
    expect(await handleReasonReply(reply("x", 78), w.deps)).toBe(true);
    expect(await handleReasonReply(reply("/annuler", 78), w.deps)).toBe(true);
    expect(w.calls.some((c) => c.startsWith("reason"))).toBe(false);
    expect(w.events).toEqual([]);
  });
});

describe("/constats", () => {
  it("nothing to fix: said; something: listed with its buttons", async () => {
    const w = world();
    await listFindings(OWNER, w.deps);
    expect(w.calls).toEqual(["send 🛡 Aucun constat ouvert."]);
    const open = [
      { id: 1, severity: "moyen", title: "Pare-feu", status: "ouvert" },
    ] as unknown as StoredFinding[];
    const w2 = world();
    await listFindings(OWNER, { ...w2.deps, store: { open: async () => open } });
    expect(w2.calls).toEqual(["buttons 1 🛡 Constats à traiter :"]);
  });
});
