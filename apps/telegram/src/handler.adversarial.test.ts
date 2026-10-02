import { describe, expect, it } from "vitest";
import { createTelegramApi, TelegramError, type TelegramUpdate } from "./api.ts";
import { handleUpdate } from "./handler.ts";

const OWNER = 111222333;
const STRANGER = 999888777;
const msg = (chatId: number, fromId: number | undefined, type = "private"): TelegramUpdate => ({
  update_id: 1,
  message: {
    message_id: 1,
    chat: { id: chatId, type },
    ...(fromId === undefined ? {} : { from: { id: fromId } }),
    text: "/etat",
  },
});
const deps = {
  allowedChatId: OWNER,
  readStatus: async () => {
    throw new Error("must not be called for a stranger");
  },
};
const silentAndJournaled = [
  { kind: "journal", type: "telegram.rejected", reason: "not_the_owner" },
];

describe("only the owner is answered", () => {
  it.each([
    ["a stranger in private", msg(STRANGER, STRANGER)],
    ["the owner inside a group", msg(-100123, OWNER, "group")],
    ["a stranger in the owner's chat id (forged)", msg(OWNER, STRANGER)],
    ["a channel post without sender", msg(OWNER, undefined, "channel")],
  ])("stays silent for %s, and journals it without the id", async (_label, update) => {
    const actions = await handleUpdate(update, deps);
    expect(actions).toEqual(silentAndJournaled);
    expect(JSON.stringify(actions)).not.toContain(String(STRANGER));
  });

  it("ignores updates that are not messages", async () => {
    expect(await handleUpdate({ update_id: 1 }, deps)).toEqual([]);
  });

  it("reports a broken journal instead of inventing a status", async () => {
    const [action] = await handleUpdate(
      {
        update_id: 1,
        message: {
          message_id: 1,
          chat: { id: OWNER, type: "private" },
          from: { id: OWNER },
          text: "/etat",
        },
      },
      deps,
    );
    expect(action?.kind === "reply" && action.text).toContain("🤒");
  });
});

describe("the token never leaks", () => {
  const TOKEN = "123456789:AAHfakefakefakefakefakefakefake12345";

  it("refuses a malformed token before any network call", () => {
    expect(() => createTelegramApi("AAHonlythesecretpart")).toThrow(TelegramError);
    expect(() => createTelegramApi("")).toThrow(TelegramError);
  });

  it("redacts the token from network errors", async () => {
    const failing = (async (url: string) => {
      throw new Error(`connect ECONNREFUSED ${url}`);
    }) as unknown as typeof fetch;
    const api = createTelegramApi(TOKEN, failing);
    const error = await api.sendMessage(1, "x").catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(TelegramError);
    expect((error as Error).message).not.toContain(TOKEN);
    expect((error as Error).message).toContain("<token>");
  });

  it("redacts the token from API errors", async () => {
    const echoing = (async (url: string) =>
      new Response(JSON.stringify({ ok: false, description: `bad request to ${url}` }), {
        status: 400,
      })) as unknown as typeof fetch;
    const api = createTelegramApi(TOKEN, echoing);
    const error = await api.getUpdates(0, 1).catch((e: unknown) => e as Error);
    expect((error as Error).message).not.toContain(TOKEN);
  });
});
