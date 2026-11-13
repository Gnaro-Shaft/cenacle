// A draft card's rules (lot B, 13/11): « Accepter » sends the text I was
// shown and nothing else, the undo delay is the server's, and a refusal —
// final — needs a second, deliberate click.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProposalView } from "./api.ts";
import {
  acceptBlockers,
  acceptBody,
  acceptedMessage,
  countdown,
  type RefuseClick,
  type RefuseStep,
  realRecipientWarning,
  refuseStep,
  slotsLeft,
} from "./proposal-rules.ts";

const MAIL = {
  subject: "Point jeudi ?",
  fromName: "Atelier Exemple",
  to: "contact@atelier.exemple.test",
  replyToElsewhere: false,
};
const card = (draft: string, mail: ProposalView["mail"] = MAIL) => ({ draft, mail });

describe("what keeps « Accepter » locked", () => {
  it("nothing, on a clean saved draft with a readable recipient", () => {
    expect(acceptBlockers(card("Bonjour"), "Bonjour")).toEqual([]);
  });

  it.each([
    ["the mail is gone", card("Bonjour", null), "Bonjour", /n'est plus sur le serveur/],
    ["the sender is unreadable", card("Bonjour", { ...MAIL, to: null }), "Bonjour", /illisible/],
    ["a slot is left", card("À {heure ?}"), "À {heure ?}", /^case à compléter$/],
    ["two slots are left", card("{a ?} {b ?}"), "{a ?} {b ?}", /^cases à compléter$/],
    ["my edit is not saved", card("Bonjour"), "Bonjour !", /enregistre d'abord/],
    ["my edit only adds a space", card("Bonjour"), "Bonjour ", /enregistre d'abord/],
  ])("locked when %s", (_label, p, text, why) => {
    const blockers = acceptBlockers(p, text);
    expect(blockers.some((b) => why.test(b))).toBe(true);
  });

  it("a slot typed into the text area locks too, even before saving", () => {
    expect(acceptBlockers(card("Bonjour"), "Bonjour {date ?}")).toHaveLength(2);
  });

  it("a slot-like text that is not a slot does not lock", () => {
    expect(slotsLeft("{Heure ?} {heure?} { heure ?} {heure !}")).toEqual([]);
    expect(slotsLeft("{heure ?}{date_rdv ?}")).toEqual(["heure", "date_rdv"]);
  });
});

describe("what « Accepter » sends", () => {
  it("the text the server showed, exactly, and only that key", () => {
    const shown = "Bonjour,\r\n\nÀ jeudi {pas un créneau} — é́ ​";
    expect(acceptBody({ draft: shown })).toEqual({ draft: shown });
    expect(Object.keys(acceptBody({ draft: shown }))).toEqual(["draft"]);
    expect(JSON.parse(JSON.stringify(acceptBody({ draft: shown }))).draft).toBe(shown);
  });

  it("never the text area's: the card sends acceptBody(p), and the api sends what it is given", () => {
    const page = readFileSync(join(import.meta.dirname, "Proposals.tsx"), "utf8");
    expect(page).toContain("accept(token, p.id, acceptBody(p))");
    expect(page).not.toMatch(/act\(token, p\.id, "accept"\)/);
    const api = readFileSync(join(import.meta.dirname, "api.ts"), "utf8");
    expect(api).toMatch(/\/accept`, \{\s*method: "POST",\s*body: JSON\.stringify\(body\)/);
  });
});

describe("the undo delay is the server's, never a number written in the page", () => {
  it.each([
    [1, "1 minute"],
    [2, "2 minutes"],
    [10, "10 minutes"],
  ])("%i → « %s »", (n, words) => {
    expect(acceptedMessage(n)).toBe(`Accepté : ${words} pour annuler.`);
    expect(realRecipientWarning(n)).toContain(`(${words} pour changer d'avis)`);
  });

  it("the card writes no delay of its own", () => {
    const page = readFileSync(join(import.meta.dirname, "Proposals.tsx"), "utf8");
    expect(page).not.toMatch(/\d+\s*min(ute)?s?\b/);
  });

  it("the countdown: time left, then the executor's turn; a broken date never shows time", () => {
    const now = Date.parse("2026-11-13T10:00:00Z");
    expect(countdown("2026-11-13T10:09:05Z", now)).toEqual({
      left: 545,
      text: "✓ Accepté — annulable encore 9 min 05 s",
    });
    expect(countdown("2026-11-13T10:00:00.400Z", now).left).toBe(1);
    for (const end of ["2026-11-13T09:59:59Z", null, "", "demain", "NaN"]) {
      const c = countdown(end, now);
      expect(c.left, String(end)).toBe(0);
      expect(c.text).toMatch(/l'exécuteur l'envoie/);
    }
  });
});

describe("refusing takes two deliberate clicks (a refusal is final)", () => {
  const play = (clicks: readonly RefuseClick[]) => {
    let step: RefuseStep = "idle";
    let sent = 0;
    for (const click of clicks) {
      const next = refuseStep(step, click);
      step = next.step;
      if (next.send) sent++;
    }
    return { step, sent };
  };

  it("« Refuser… » alone sends nothing: it asks", () => {
    expect(play(["refuse"])).toEqual({ step: "confirming", sent: 0 });
  });

  it("« Refuser… » then « Oui, refuser » sends once", () => {
    expect(play(["refuse", "confirm"])).toEqual({ step: "idle", sent: 1 });
  });

  it("« Garder » sends nothing and closes the question", () => {
    expect(play(["refuse", "keep"])).toEqual({ step: "idle", sent: 0 });
  });

  it.each([
    [["confirm"]],
    [["keep", "confirm"]],
    [["refuse", "keep", "confirm"]],
    [["refuse", "refuse"]],
  ] as const)("a stale or double click sends nothing: %j", (clicks) => {
    expect(play(clicks).sent).toBe(0);
  });

  it("a text changed elsewhere, even of the same length, closes an open question", () => {
    const page = readFileSync(join(import.meta.dirname, "Proposals.tsx"), "utf8");
    expect(page).toContain("key={`${p.id}-${p.status}-${p.draft}`}");
    expect(page).not.toMatch(/key=\{`[^`]*p\.draft\.length/);
  });

  it("a double click on « Oui, refuser » sends once", () => {
    expect(play(["refuse", "confirm", "confirm"]).sent).toBe(1);
  });
});
