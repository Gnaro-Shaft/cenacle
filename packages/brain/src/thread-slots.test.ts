import type { MailForModel } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import { extractThreadSlots, parseSlotValue } from "./thread-slots.ts";

const mail: MailForModel = {
  uid: 1,
  fromName: "Paul",
  domain: "client.example",
  subject: "Erreur 500",
  text: "Bonjour, l'API renvoie une erreur 500 depuis ce matin.",
};

describe("parseSlotValue", () => {
  it.each([
    ["« l'erreur 500 »", "l'erreur 500"],
    ["  jeudi à 14 h.\n", "jeudi à 14 h"],
    ["?", null],
    ["", null],
  ])("%j → %j", (answer, expected) => {
    expect(parseSlotValue(answer)).toBe(expected);
  });
});

describe("extractThreadSlots", () => {
  it("one question per slot; '?' leaves the slot empty", async () => {
    const answers: Record<string, string> = { creneau: "?", sujet: "l'erreur 500" };
    const v = await extractThreadSlots(mail, ["creneau", "sujet"], {
      ask: async (p) => (p.includes("problème") ? (answers.sujet ?? "") : (answers.creneau ?? "")),
    });
    expect(v).toEqual({ sujet: "l'erreur 500" });
  });
});
