// Lot 3 (ADR-0032, points 16 to 19): a card typed by hand is held to the same
// fields and rules as an extracted one; a link is clickable only in https and,
// for a mail's card, on a host declared today; the Telegram alert carries
// numbers only, and is "said" only once it has left. The agent never moves a
// card nor adds one by hand: its code is read to hold it.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { alertIfNew, alertText } from "./alert.ts";
import { cardByHand, httpsLink, shownLink } from "./by-hand.ts";
import { testConfig } from "./test-config.ts";

const config = testConfig();
const form = {
  intitule: "Ingénieur IA",
  entreprise: "Banque Fictive",
  intermediaire: "direct",
  stack: ["Python"],
  tjm: [600, 700],
  teletravail: "total",
  lieu: "Lyon",
  lien: "https://autre-site.test/mission/1",
  note: "Repérée sur un salon.",
};

describe("a card typed by hand", () => {
  it("is sorted by the same rules, decided by me, never by the model", () => {
    const r = cardByHand(form, config);
    expect(r).toMatchObject({ ok: true, card: { column: "alert", decidedBy: "rule" } });
    const esn = cardByHand({ ...form, entreprise: "Grande ESN" }, config);
    expect(esn).toMatchObject({ ok: true, card: { column: "detected", reason: "esn_list" } });
    const doubt = cardByHand({ ...form, intermediaire: "inconnu" }, config);
    expect(doubt).toMatchObject({ ok: true, card: { decidedBy: "me" } });
  });

  it("any https link of mine is kept: I typed it, the agent never opens it", () => {
    expect(cardByHand(form, config)).toMatchObject({ card: { link: form.lien } });
    expect(cardByHand({ ...form, lien: "" }, config)).toMatchObject({ card: { link: null } });
  });

  it("is cleaned like an extracted one: no address, account or phone in its texts", () => {
    const r = cardByHand(
      {
        ...form,
        note: "Appeler Jean au 06 12 34 56 78 ou jean@corp.example",
        entreprise: "@rh Banque",
      },
      config,
    );
    expect(JSON.stringify(r)).not.toMatch(/06 12|@|corp\.example/);
  });

  it.each<[string, Record<string, unknown> | unknown]>([
    ["not an object", "Ingénieur IA"],
    ["an array", [form]],
    ["an unknown field (a pasted post)", { ...form, post: "Texte entier du post…" }],
    ["no title", { ...form, intitule: "   " }],
    ["a title of links only", { ...form, intitule: "https://x.test" }],
    ["an invented intermediary", { ...form, intermediaire: "peut-être" }],
    ["an invented remote work", { ...form, teletravail: "hybride" }],
    ["a stack as text", { ...form, stack: "Python" }],
    ["a stack word that is a link", { ...form, stack: ["https://x.test"] }],
    ["a reversed rate", { ...form, tjm: [700, 600] }],
    ["a rate as text", { ...form, tjm: "600" }],
    ["a javascript: link", { ...form, lien: "javascript:alert(1)" }],
    ["an http link", { ...form, lien: "http://x.test/" }],
    ["a data: link", { ...form, lien: "data:text/html,<script>1</script>" }],
    ["a link with a space", { ...form, lien: "https://x.test/a b" }],
    ["a link with a quote", { ...form, lien: 'https://x.test/"onmouseover=' }],
    ["a very long link", { ...form, lien: `https://x.test/${"a".repeat(2000)}` }],
    ["a note of only an address", { ...form, note: "jean@corp.example" }],
  ])("refuses %s, with words of the code", (_label, input) => {
    const r = cardByHand(input, config);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeLessThan(80);
  });

  it("a long note is cut at 280 characters, never refused", () => {
    const r = cardByHand({ ...form, note: "mot ".repeat(200) }, config);
    expect(r.ok && (r.card.note?.length ?? 0) <= 280).toBe(true);
  });
});

describe("which link the page may click", () => {
  it("https only, whole", () => {
    expect(httpsLink("https://x.test/a?b=1")).toBe("https://x.test/a?b=1");
    for (const bad of [
      "HTTPS:/x",
      "javascript:alert(1)",
      "http://x.test",
      " https://x.test",
      null,
      3,
    ]) {
      expect(httpsLink(bad)).toBeNull();
    }
  });

  it("a mail's card: only on a host its platform declares today", () => {
    const mail = { source: "mail" as const, platform: "Plateforme fictive" };
    expect(
      shownLink({ ...mail, link: "https://clic.plateforme.example/r?u=1" }, config),
    ).not.toBeNull();
    expect(shownLink({ ...mail, link: "https://attacker.test/x" }, config)).toBeNull();
    expect(
      shownLink(
        { ...mail, platform: "Plateforme disparue", link: "https://plateforme.example/m" },
        config,
      ),
    ).toBeNull();
  });
});

describe("the Telegram alert", () => {
  const counts = { detected: 2, direct: 1, floor: 1 };
  const events: { type: string; payload?: Record<string, unknown> }[] = [];
  const journal = { append: async (e: (typeof events)[number]) => events.push(e) };

  it("numbers and fixed words only, and says the sorting was done by AI", () => {
    const text = alertText(3, counts);
    expect(text).toMatch(/3 nouvelles missions/);
    expect(text).toMatch(/IA/);
    expect(text.replace(/\d+/g, "N")).not.toMatch(/Banque|Ingénieur|https|@/);
  });

  it("nothing new: nothing sent", async () => {
    let sent = 0;
    const out = await alertIfNew({
      lastSent: async () => new Date(0),
      newAlerts: async () => 0,
      send: async () => {
        sent++;
      },
      sendFailure: () => null,
      journal,
      counts,
    });
    expect(out).toBe("nothing");
    expect(sent).toBe(0);
  });

  it("a failed send writes no « sent »: the next pass says it again", async () => {
    events.length = 0;
    const out = await alertIfNew({
      lastSent: async () => null,
      newAlerts: async () => 2,
      send: async () => {
        throw new Error("network");
      },
      sendFailure: () => "network",
      journal,
      counts,
    });
    expect(out).toBe("failed");
    expect(events.map((e) => e.type)).toEqual(["prospection.alert_failed"]);
  });

  it("sent: journaled as a number, since the last one that left", async () => {
    events.length = 0;
    let since: Date | null | undefined;
    const last = new Date("2026-10-22T08:00:00Z");
    await alertIfNew({
      lastSent: async () => last,
      newAlerts: async (s) => {
        since = s;
        return 1;
      },
      send: async () => undefined,
      sendFailure: () => null,
      journal,
      counts,
    });
    expect(since).toBe(last);
    expect(events).toEqual([
      { agent: "prospection", type: "prospection.alert_sent", payload: { count: 1 } },
    ]);
  });

  it("any other error is a bug, thrown, never swallowed", async () => {
    await expect(
      alertIfNew({
        lastSent: async () => null,
        newAlerts: async () => 1,
        send: async () => {
          throw new TypeError("bug");
        },
        sendFailure: () => null,
        journal,
        counts,
      }),
    ).rejects.toThrow(TypeError);
  });
});

describe("the agent never moves a card, nor adds one by hand (point 17)", () => {
  const ROOT = join(import.meta.dirname, "..", "..", "..");
  const sources = ["packages/prospection/src", "apps/prospection/src"].flatMap((dir) =>
    readdirSync(join(ROOT, dir))
      .filter((f) => f.endsWith(".ts") && !f.includes(".test.") && f !== "test-config.ts")
      .map((f) => [join(dir, f), readFileSync(join(ROOT, dir, f), "utf8")] as const),
  );

  it("its code holds no move, no hand entry, no update of the cards", () => {
    expect(sources.length).toBeGreaterThan(5);
    for (const [path, text] of sources) {
      // by-hand.ts builds a typed card for the server; only the server stores it.
      if (path.endsWith("by-hand.ts")) continue;
      expect(text, path).not.toMatch(/\.move\(|addByHand|update\s+prospection_cartes/i);
    }
  });
});
