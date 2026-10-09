// /cto on Telegram (ADR-0020, J2b): only the owner, a malformed question
// explained and never relayed, an acknowledgement first, an answer cut into
// messages Telegram accepts — nothing lost — and every failure said in a short
// sentence that leaks nothing.
import { type CtoReply, CtoServiceError } from "@cenacle/cto/client";
import { describe, expect, it } from "vitest";
import type { TelegramUpdate } from "./api.ts";
import { ACK, MAX_MESSAGE, MAX_MESSAGES, relayToCto, splitForTelegram } from "./cto-relay.ts";
import { handleUpdate } from "./handler.ts";

const OWNER = 111222333;
const STRANGER = 999888777;
const say = (text: string, chatId = OWNER, fromId = OWNER, type = "private"): TelegramUpdate => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: chatId, type }, from: { id: fromId }, text },
});
const deps = {
  allowedChatId: OWNER,
  readStatus: async () => {
    throw new Error("not used");
  },
};
const reply = (text: string, over: Partial<CtoReply> = {}): CtoReply => ({
  text,
  summary: "✔ 2 références vérifiées dans le dépôt",
  cut: false,
  revised: false,
  seconds: 30,
  documents: 41,
  ...over,
});

describe("/cto in the handler", () => {
  it("the owner's question becomes one relay, line breaks kept, the command form @bot accepted", async () => {
    expect(await handleUpdate(say("/cto Où en est M2 ?"), deps)).toEqual([
      { kind: "ask_cto", chatId: OWNER, question: "Où en est M2 ?" },
    ]);
    expect(await handleUpdate(say("/cto@cenacle_iris_bot   ligne 1\nligne 2  "), deps)).toEqual([
      { kind: "ask_cto", chatId: OWNER, question: "ligne 1\nligne 2" },
    ]);
  });

  it.each([
    ["no question", "/cto"],
    ["only spaces", "/cto    "],
    ["too long", `/cto ${"x".repeat(2001)}`],
    ["a control character", "/cto a\u0007b"],
  ])("%s: explained with the rule, never relayed", async (_, text) => {
    const actions = await handleUpdate(say(text), deps);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "reply", chatId: OWNER });
    expect(JSON.stringify(actions)).toMatch(/Jamais de nom de client/);
  });

  it.each([
    ["a stranger", say("/cto q", STRANGER, STRANGER)],
    ["the owner in a group", say("/cto q", -100123, OWNER, "group")],
  ])("%s: silence, nothing relayed", async (_, update) => {
    const actions = await handleUpdate(update, deps);
    expect(actions.some((a) => a.kind === "ask_cto")).toBe(false);
  });

  it("/aide states the rule", async () => {
    expect(JSON.stringify(await handleUpdate(say("/aide"), deps))).toMatch(
      /cto.*Jamais de nom de client ni de contenu de mail/s,
    );
  });
});

describe("splitForTelegram", () => {
  it("a short answer stays whole", () => {
    expect(splitForTelegram("Une réponse.")).toEqual(["Une réponse."]);
  });

  it("cuts at paragraph breaks, every part within the limit, nothing lost", () => {
    const text = Array.from({ length: 30 }, (_, i) => `Paragraphe ${i} ${"mot ".repeat(60)}`).join(
      "\n\n",
    );
    const parts = splitForTelegram(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(MAX_MESSAGE);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " ").trim());
  });

  it("a line with no space at all is cut hard, still nothing lost", () => {
    const text = "a".repeat(MAX_MESSAGE * 2 + 7);
    const parts = splitForTelegram(text);
    expect(parts.map((p) => p.length)).toEqual([MAX_MESSAGE, MAX_MESSAGE, 7]);
    expect(parts.join("")).toBe(text);
  });
});

describe("relayToCto", () => {
  it("acknowledges first, then the answer with its check and the reminder it is an opinion", async () => {
    const sent: string[] = [];
    await relayToCto("q", {
      send: async (t) => {
        sent.push(t);
      },
      ask: async () => reply("Voir ADR-0020."),
    });
    expect(sent[0]).toBe(ACK);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("Voir ADR-0020.");
    expect(sent[1]).toContain("✔ 2 références vérifiées");
    expect(sent[1]).toContain("Un avis à vérifier");
  });

  it("a long answer: numbered messages within the limit, capped, the rest pointed to the page", async () => {
    const sent: string[] = [];
    const huge = Array.from({ length: 400 }, (_, i) => `Ligne ${i} ${"mot ".repeat(20)}`).join(
      "\n",
    );
    await relayToCto("q", {
      send: async (t) => {
        sent.push(t);
      },
      ask: async () => reply(huge, { cut: true }),
    });
    const answers = sent.slice(1);
    for (const m of answers) expect(m.length).toBeLessThanOrEqual(4096);
    expect(answers.filter((m) => /^\(\d+\/\d+\) /.test(m))).toHaveLength(MAX_MESSAGES);
    expect(answers.at(-1)).toMatch(/depuis la page/);
  });

  it.each([
    ["busy", /occupé/],
    ["unreachable", /ne tourne pas/],
    ["model_unavailable", /modèle local/],
    ["timeout", /à temps/],
    ["broken", /n'a pas pu répondre/],
  ] as const)("the CTO %s: one short sentence after the acknowledgement", async (code, said) => {
    const sent: string[] = [];
    await relayToCto("q", {
      send: async (t) => {
        sent.push(t);
      },
      ask: async () => {
        throw new CtoServiceError(code, `détail interne ${code}`);
      },
    });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatch(said);
    expect(sent[1]).not.toMatch(/détail interne/);
  });

  it("an unexpected error leaks nothing", async () => {
    const sent: string[] = [];
    await relayToCto("q", {
      send: async (t) => {
        sent.push(t);
      },
      ask: async () => {
        throw new Error("ECONNREFUSED claire@client.example");
      },
    });
    expect(sent.join()).not.toMatch(/claire|ECONNREFUSED/);
  });

  it("Telegram down: the relay never throws (the bot keeps running)", async () => {
    await expect(
      relayToCto("q", {
        send: async () => {
          throw new Error("Telegram unreachable");
        },
        ask: async () => reply("ok"),
      }),
    ).resolves.toBeUndefined();
  });
});
