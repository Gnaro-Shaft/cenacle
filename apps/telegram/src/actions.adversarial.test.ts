// The bot through a database outage (found by reading the code, 2026-10-10):
// a failed journal write threw, the update came back after the restart and
// threw again — a crash every 30 s while the database was away, /etat
// included, and /stop never said it was not recorded. The real handler
// decides; perform() carries it out against a database that is away.
import { InvalidEventError } from "@cenacle/journal";
import { describe, expect, it } from "vitest";
import { perform, STOP_NOT_RECORDED } from "./actions.ts";
import type { TelegramUpdate } from "./api.ts";
import { handleUpdate } from "./handler.ts";

const OWNER = 4242;
const update = (text: string, from = OWNER): TelegramUpdate => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: from, type: "private" }, from: { id: from }, text },
});
const DB_ERROR = "connect ECONNREFUSED db.internal.example:5432 password authentication";

function bot(record: (type: string) => Promise<void>) {
  const replies: string[] = [];
  const logs: string[] = [];
  const recorded: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const asked: string[] = [];
  const run = async (u: TelegramUpdate) =>
    perform(
      await handleUpdate(u, {
        allowedChatId: OWNER,
        readStatus: async () => {
          throw new Error(DB_ERROR);
        },
      }),
      {
        reply: async (_, text) => {
          replies.push(text);
        },
        askCto: (_, q) => asked.push(q),
        record: async (type, payload) => {
          await record(type);
          recorded.push({ type, payload });
        },
        log: (l) => logs.push(l),
      },
    );
  return { run, replies, logs, recorded, asked };
}
const away = async () => {
  throw new Error(DB_ERROR);
};
const up = async () => {};

describe("the bot through a database outage", () => {
  it("/stop says the stop was NOT recorded, never 'noted', and does not throw", async () => {
    const b = bot(away);
    await b.run(update("/stop"));
    expect(b.replies).toEqual([STOP_NOT_RECORDED]);
    expect(b.replies.join()).not.toMatch(/noté/);
    expect(b.logs).toEqual(["⚠ /stop reçu mais non enregistré : base injoignable"]);
  });

  it("a stranger's message is refused without an answer, and does not throw", async () => {
    const b = bot(away);
    await b.run(update("/etat", 666));
    expect(b.replies).toEqual([]);
    expect(b.logs).toHaveLength(1);
    expect(b.logs[0]).toMatch(/inconnu refusé/);
  });

  it("/etat still answers (sick, without the error's text), and the next /stop too", async () => {
    const b = bot(away);
    await b.run(update("/etat"));
    await b.run(update("/stop"));
    expect(b.replies[0]).toMatch(/^🤒/);
    expect(b.replies[1]).toBe(STOP_NOT_RECORDED);
  });

  it("neither the replies nor the console hold the database's error", async () => {
    const b = bot(away);
    for (const text of ["/stop", "/etat", "/aide"]) await b.run(update(text));
    await b.run(update("/stop", 666));
    const all = [...b.replies, ...b.logs].join("\n");
    expect(all).not.toMatch(/ECONNREFUSED|db\.internal|5432|password/);
  });

  it("an invalid event is our bug, not an outage: it still throws", async () => {
    const b = bot(async () => {
      throw new InvalidEventError("payload must be a plain object");
    });
    await expect(b.run(update("/stop"))).rejects.toBeInstanceOf(InvalidEventError);
    expect(b.replies).toEqual([]);
  });

  it("with the database there, nothing changes", async () => {
    const b = bot(up);
    await b.run(update("/stop"));
    await b.run(update("/etat", 666));
    expect(b.recorded).toEqual([
      { type: "stop.requested", payload: {} },
      { type: "telegram.rejected", payload: { reason: "not_the_owner" } },
    ]);
    expect(b.replies).toEqual(["🛑 Arrêt demandé — c'est noté dans le journal."]);
    expect(b.logs).toEqual([]);
  });

  it("only the reply right after a failed stop is replaced", async () => {
    const replies: string[] = [];
    await perform(
      [
        { kind: "journal", type: "stop.requested" },
        { kind: "reply", chatId: OWNER, text: "noté" },
        { kind: "reply", chatId: OWNER, text: "suite" },
      ],
      {
        reply: async (_, t) => {
          replies.push(t);
        },
        askCto: () => {},
        record: away,
        log: () => {},
      },
    );
    expect(replies).toEqual([STOP_NOT_RECORDED, "suite"]);
  });
});
