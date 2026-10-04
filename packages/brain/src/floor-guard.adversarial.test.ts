// Second line of defence (C2): even if a caller forgot the article 9 floor,
// no model entry point reads a sensitive mail — it refuses before any call.
import { type MailForModel, SensitiveMailError } from "@cenacle/core";
import type { NewEvent } from "@cenacle/journal";
import { describe, expect, it } from "vitest";
import { chooseTrame } from "./choose-trame.ts";
import { classifyMail } from "./classify.ts";
import { sortByModel } from "./sort-by-model.ts";
import { extractThreadSlots } from "./thread-slots.ts";

const sensitive: MailForModel = {
  uid: 1,
  fromName: "Camille",
  domain: "client.example",
  subject: "Point",
  text: "Je serai en arrêt maladie jusqu'à vendredi.",
};
const ordinary: MailForModel = { ...sensitive, uid: 2, text: "Le devis est signé." };
// Never reached: the guards refuse before any model is touched.
const NO_MODEL = {} as never;

describe("model entry points refuse a sensitive mail before asking anything", () => {
  it("choosing a template", async () => {
    let asked = 0;
    const ask = async () => {
      asked++;
      return "decliner";
    };
    await expect(chooseTrame(sensitive, [{ id: "decliner", quand: "x" }], { ask })).rejects.toThrow(
      SensitiveMailError,
    );
    expect(asked).toBe(0);
  });

  it("copying thread slots", async () => {
    let asked = 0;
    const ask = async () => {
      asked++;
      return "?";
    };
    await expect(extractThreadSlots(sensitive, ["creneau"], { ask })).rejects.toThrow(
      SensitiveMailError,
    );
    expect(asked).toBe(0);
  });

  it("classifying one mail", async () => {
    await expect(classifyMail(sensitive, { local: NO_MODEL })).rejects.toThrow(SensitiveMailError);
  });

  it("sorting a batch: one sensitive mail stops it before anything is routed or journaled", async () => {
    const events: NewEvent[] = [];
    const journal = {
      append: async (e: NewEvent) => {
        events.push(e);
        return { id: 1n, occurredAt: new Date(), agent: e.agent, type: e.type, payload: {} };
      },
      read: async () => [],
    };
    let classified = 0;
    await expect(
      sortByModel([ordinary, sensitive], {
        journal,
        local: NO_MODEL,
        classify: async (m) => {
          classified++;
          return { uid: m.uid, category: "bruit", valid: true, durationMs: 0 };
        },
      }),
    ).rejects.toThrow(SensitiveMailError);
    expect(classified).toBe(0);
    expect(events).toEqual([]);
  });
});
