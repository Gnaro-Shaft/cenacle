// `/maison` (ADR-0048): the first line is the title, the rest the
// description; a refusal never quotes the text; the bot records a demand
// waiting — it never accepts — and never says "recorded" when it was not.
import { describe, expect, it } from "vitest";
import { handleUpdate } from "./handler.ts";
import { type MaisonAction, maisonAction, performMaison } from "./maison-bot.ts";

const CHAT = 42;
const update = (text: string, chat = CHAT) => ({
  update_id: 1,
  message: {
    message_id: 1,
    chat: { id: chat, type: "private" as const },
    from: { id: chat },
    text,
  },
});
const deps = { allowedChatId: CHAT, readStatus: async () => Promise.reject(new Error("x")) };

describe("reading /maison", () => {
  it("title on the first line, description below, as the handler routes it", async () => {
    const [a] = await handleUpdate(
      update("/maison Refaire la page\nAvec des tests.\nEt la doc."),
      deps,
    );
    expect(a).toEqual({
      kind: "maison_deposer",
      chatId: CHAT,
      titre: "Refaire la page",
      description: "Avec des tests.\nEt la doc.",
    });
  });

  it("the title on the line after the command works too", async () => {
    const [a] = await handleUpdate(update("/maison\nRefaire la page\nAvec des tests."), deps);
    expect(a).toMatchObject({ kind: "maison_deposer", titre: "Refaire la page" });
  });

  it("a title without a description: the usage, never a default description", () => {
    for (const rest of ["Refaire la page", "", "Titre\n   "]) {
      expect(maisonAction(rest, CHAT).kind).toBe("reply");
    }
  });

  it("a third party's data: refused by its category, the text never quoted", () => {
    const a = maisonAction("Écrire à Jean\nson adresse jean.dupont@exemple.org", CHAT);
    if (a.kind !== "reply") throw new Error("expected a refusal");
    expect(a.text).toMatch(/courriel/);
    expect(a.text).not.toMatch(/jean|dupont|exemple/i);
  });

  it("another person's chat: never routed", async () => {
    const actions = await handleUpdate(update("/maison T\nD", 7), deps);
    expect(actions.some((x) => x.kind === "maison_deposer")).toBe(false);
  });
});

describe("recording", () => {
  const action: MaisonAction = {
    kind: "maison_deposer",
    chatId: CHAT,
    titre: "T",
    description: "D",
  };
  const run = async (over: Partial<Parameters<typeof performMaison>[1]> = {}) => {
    const replies: string[] = [];
    const logs: string[] = [];
    await performMaison(action, {
      create: async () => ({ id: 7 }),
      dossier: () => "maison-etalon",
      reply: async (_c, t) => void replies.push(t),
      log: (l) => void logs.push(l),
      ...over,
    });
    return { replies, logs };
  };

  it("recorded waiting: its number, the page to accept, the rule", async () => {
    const { replies } = await run();
    expect(replies[0]).toMatch(/n° 7 enregistrée/);
    expect(replies[0]).toMatch(/accepte-la sur la page/);
    expect(replies[0]).toMatch(/ni nom de client ni contenu de mail/);
  });

  it("the database away: NOT recorded, said; the error's text never quoted", async () => {
    const { replies, logs } = await run({
      create: async () => Promise.reject(new Error("connect ECONNREFUSED 10.0.0.1 T D")),
    });
    expect(replies[0]).toMatch(/NON enregistrée/);
    expect([...replies, ...logs].join()).not.toMatch(/10\.0\.0\.1|ECONNREFUSED/);
  });

  it("the liaison not configured: nothing recorded, said", async () => {
    let created = false;
    const { replies } = await run({
      dossier: () => null,
      create: async () => {
        created = true;
        return { id: 1 };
      },
    });
    expect(created).toBe(false);
    expect(replies[0]).toMatch(/pas configurée/);
  });
});
