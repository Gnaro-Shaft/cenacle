// The replay of mesure:rangement --simuler follows production's order with
// production's parts: rules (mass mail, client authentication), the floor,
// then the model — and the model never sees what production keeps from it.
// If the model stops answering, the replay stops: no half measure.
import type { Category, MailForModel } from "@cenacle/core";
import { parseRules } from "@cenacle/mail";
import { describe, expect, it } from "vitest";
import { replaySorting, type ToReplay } from "./mesure-simulation.ts";

const rules = parseRules(`
[clients_prospects]
domains = ["client.example"]
[administratif]
domains = ["banque.example"]
`);
const view = (
  uid: number,
  domain: string | null,
  text = "Bonjour, un message ordinaire.",
): MailForModel => ({
  uid,
  fromName: "Personne Fictive",
  domain,
  subject: text === "" ? "" : "Un objet",
  text,
});
const mail = (v: MailForModel, mass = false, senderAuthenticated = true): ToReplay => ({
  view: v,
  mass,
  senderAuthenticated,
});

describe("replaySorting", () => {
  it("rules first, then the floor, then the model — each mail decided once", async () => {
    const asked: number[] = [];
    const result = await replaySorting(
      [
        mail(view(1, "client.example"), true), // client rule beats mass
        mail(view(2, "banque.example"), true), // mass beats the administratif rule
        mail(view(3, "banque.example")), // the rule
        mail(view(4, "client.example"), false, false), // unauthenticated client: À trier
        mail(view(5, null)), // unreadable sender
        mail(view(6, "inconnu.example", "")), // nothing to read: the floor
        mail(view(7, "inconnu.example")), // the model
      ],
      rules,
      async (v) => {
        asked.push(v.uid);
        return { category: "administratif" as Category };
      },
    );
    expect(Object.fromEntries(result)).toEqual({
      1: { category: "clients_prospects", decidedBy: "rule" },
      2: { category: "bruit", decidedBy: "masse" },
      3: { category: "administratif", decidedBy: "rule" },
      4: { category: "a_trier", decidedBy: "unauthenticated" },
      5: { category: "a_trier", decidedBy: "unreadable" },
      6: { category: "a_trier", decidedBy: "set_aside" },
      7: { category: "administratif", decidedBy: "model" },
    });
    expect(asked).toEqual([7]);
  });

  it("a mail the floor keeps is never given to the model", async () => {
    let asked = 0;
    await replaySorting([mail(view(1, "inconnu.example", ""))], rules, async () => {
      asked++;
      return { category: "bruit" };
    });
    expect(asked).toBe(0);
  });

  it("the model stops answering: the replay stops, no partial result", async () => {
    const down = Object.assign(new Error("down"), { name: "ModelUnavailableError" });
    await expect(
      replaySorting([mail(view(1, "a.example")), mail(view(2, "b.example"))], rules, async (v) => {
        if (v.uid === 2) throw down;
        return { category: "bruit" };
      }),
    ).rejects.toBe(down);
  });

  it("progress counts only the mails the model is asked about", async () => {
    const seen: string[] = [];
    await replaySorting(
      [mail(view(1, "banque.example")), mail(view(2, "a.example")), mail(view(3, "b.example"))],
      rules,
      async () => ({ category: "bruit" }),
      (done, total) => seen.push(`${done}/${total}`),
    );
    expect(seen).toEqual(["1/2", "2/2"]);
  });

  it("nothing to replay: nothing asked, an empty result", async () => {
    let asked = 0;
    const result = await replaySorting([], rules, async () => {
      asked++;
      return { category: "bruit" };
    });
    expect(result.size).toBe(0);
    expect(asked).toBe(0);
  });
});
