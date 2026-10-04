// The M2 measures must be published as they are: counts only, never a value
// read from a real mail; a leak cannot hide behind case, accents, spacing,
// quoting or escaping; a subject cannot drive the terminal it is shown in.
import { describe, expect, it } from "vitest";
import {
  findLeaks,
  forTerminal,
  measureSorting,
  type Needle,
  searchable,
  skeleton,
  type Verdict,
} from "./measure.ts";

describe("measureSorting", () => {
  const v = (
    iris: Verdict["iris"],
    truth: Verdict["truth"],
    decidedBy: Verdict["decidedBy"] = "model",
  ): Verdict => ({
    iris,
    truth,
    decidedBy,
  });

  it("counts, rates and the serious mistake", () => {
    const m = measureSorting([
      v("clients_prospects", "clients_prospects"),
      v("bruit", "clients_prospects"),
      v("a_trier", "administratif", "set_aside"),
      v("administratif", "administratif", "rule"),
    ]);
    expect(m.total).toBe(4);
    expect(m.correct).toBe(2);
    expect(m.accuracy).toBe(0.5);
    expect(m.accuracyDecided).toBeCloseTo(2 / 3);
    expect(m.aTrierShare).toBe(0.25);
    expect(m.clientsInBruit).toBe(1);
    expect(m.byDecider.model).toEqual({ total: 2, correct: 1 });
    expect(m.byDecider.set_aside).toEqual({ total: 1, correct: 0 });
    expect(m.confusion.bruit.clients_prospects).toBe(1);
  });

  it("no verdict: rates are null, not NaN nor 0", () => {
    const m = measureSorting([]);
    expect([m.accuracy, m.accuracyDecided, m.aTrierShare]).toEqual([null, null, null]);
  });

  it("everything left in À trier: no decided accuracy", () => {
    expect(measureSorting([v("a_trier", "bruit")]).accuracyDecided).toBeNull();
  });

  it("the result holds counts only: nothing of a mail can travel in it", () => {
    const m = measureSorting([v("bruit", "bruit")]);
    expect(JSON.stringify(m)).not.toMatch(/uid|subject|objet|@/i);
  });

  it.each([
    ["an unknown category", { iris: "spam", truth: "bruit", decidedBy: "model" }],
    ["an unknown decider", { iris: "bruit", truth: "bruit", decidedBy: "me" }],
    ["a prototype key", { iris: "__proto__", truth: "bruit", decidedBy: "model" }],
  ])("refuses %s", (_label, verdict) => {
    expect(() => measureSorting([verdict as unknown as Verdict])).toThrow(/unknown/);
  });
});

describe("findLeaks", () => {
  const needles: Needle[] = [
    { kind: "objet", value: "Point d'étape sur la mission" },
    { kind: "adresse", value: "Claire.Fictive@Client.example" },
  ];
  const where = (text: string) => findLeaks(needles, [{ where: "events", text }]);

  it("nothing found in clean rows", () => {
    expect(where('{"type":"mail.collected","count":3}')).toEqual([]);
  });

  it.each([
    ["as is", "subject=Point d'étape sur la mission"],
    ["upper case", "POINT D'ÉTAPE SUR LA MISSION"],
    ["other spacing and quoting", '"point  d\\"étape\nsur la   mission"'],
    ["JSON-escaped accents", "Point d'\\u00e9tape sur la mission"],
    ["decomposed accents (NFD)", "Point d'e\u0301tape sur la mission".normalize("NFD")],
    ["full-width letters", "Ｐｏｉｎｔ d'étape sur la mission"],
  ])("finds a subject written %s", (_label, text) => {
    expect(where(text)).toEqual([{ kind: "objet", where: "events" }]);
  });

  it("finds an address whatever its case, and says where", () => {
    expect(
      findLeaks(needles, [{ where: "proposals", text: "to claire.fictive@client.EXAMPLE" }]),
    ).toEqual([{ kind: "adresse", where: "proposals" }]);
  });

  it("a hit never carries the value it found", () => {
    const leaks = where("Point d'étape sur la mission, claire.fictive@client.example");
    expect(JSON.stringify(leaks)).not.toMatch(/tape|claire|client/i);
    expect(leaks).toHaveLength(2);
  });

  it("one hit per kind and place, however often it appears", () => {
    expect(where("Point d'étape sur la mission ".repeat(50))).toHaveLength(1);
  });

  it("short, empty and hexadecimal needles are not searched (they would match by chance)", () => {
    const { kept, tooShort } = searchable([
      { kind: "objet", value: "Re:" },
      { kind: "objet", value: "" },
      { kind: "objet", value: "   ---   " },
      { kind: "nom", value: "Bob" },
      { kind: "objet", value: "deadbeef00" },
      { kind: "domaine", value: "client.example" },
    ]);
    expect(kept).toEqual([{ kind: "domaine", value: "clientexample" }]);
    expect(tooShort).toBe(3);
    // The HMAC keys Cénacle keeps on purpose are no leak.
    expect(
      findLeaks(
        [{ kind: "objet", value: "deadbeef00" }],
        [{ where: "mail_items", text: "deadbeef00".repeat(7) }],
      ),
    ).toEqual([]);
  });
});

describe("skeleton", () => {
  it("keeps letters of every script and digits, drops the rest", () => {
    expect(skeleton("Ça coûte 12 € — 東京!")).toBe("çacoûte12東京");
  });

  it("does not choke on a broken escape", () => {
    expect(skeleton("\\u00zz é")).toBe("u00zzé");
  });
});

describe("forTerminal", () => {
  it.each([
    ["an ANSI escape", "\u001b[2J\u001b[31mfacture\u001b[0m"],
    ["a carriage return overwriting the line", "Objet bénin\rjuste\u0007"],
    ["a NEL and a line separator", "un\u0085deux\u2028trois"],
    ["a bidi override", "facture\u202Efdp.exe"],
    ["a bidi isolate", "a\u2066b\u2069c"],
  ])("neutralizes %s", (_label, text) => {
    expect(forTerminal(text)).not.toMatch(/[\p{Cc}\u2028\u2029\u202a-\u202E\u2066-\u2069]/u);
  });

  it("keeps accents and bounds the length", () => {
    expect(forTerminal("Point d'étape")).toBe("Point d'étape");
    const long = forTerminal("é".repeat(500));
    expect(long).toHaveLength(120);
    expect(long.endsWith("…")).toBe(true);
  });
});
