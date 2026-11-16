// When a reminder is due (ADR-0041): a closed grammar in Paris time, never
// guessed. The changes of time are the trap: 02:30 does not exist on
// 2027-03-28, and comes twice on 2026-10-25 — both refused.
import { describe, expect, it } from "vitest";
import { MAX_AHEAD_MS, parseWhen, sayWhen, wallToInstant } from "./rappel-quand.ts";

/** Monday 16 November 2026, 10:00 in Paris (UTC+1). */
const NOW = new Date("2026-11-16T09:00:00Z");
const at = (input: string, now = NOW) => {
  const w = parseWhen(input, now);
  return "error" in w ? w.error : { at: w.at.toISOString(), rest: w.rest };
};

describe("the forms it reads, in Paris time", () => {
  it.each([
    ["2026-11-20 09:00 dentiste", "2026-11-20T08:00:00.000Z", "dentiste"],
    ["2026-11-20 9h30 dentiste", "2026-11-20T08:30:00.000Z", "dentiste"],
    ["20/11 09:00 dentiste", "2026-11-20T08:00:00.000Z", "dentiste"],
    ["demain 09:00 dentiste", "2026-11-17T08:00:00.000Z", "dentiste"],
    ["DEMAIN 09:00 dentiste", "2026-11-17T08:00:00.000Z", "dentiste"],
    ["dans 2 h dentiste", "2026-11-16T11:00:00.000Z", "dentiste"],
    ["dans 30min dentiste", "2026-11-16T09:30:00.000Z", "dentiste"],
    ["dans 3 jours dentiste", "2026-11-19T09:00:00.000Z", "dentiste"],
    ["  2026-11-20 09:00   dentiste  ", "2026-11-20T08:00:00.000Z", "dentiste"],
  ])("%s", (input, iso, rest) => {
    expect(at(input)).toEqual({ at: iso, rest });
  });

  it("summer time: 15/07 09:00 is 07:00 UTC", () => {
    expect(at("2027-07-15 09:00 x")).toEqual({ at: "2027-07-15T07:00:00.000Z", rest: "x" });
  });

  it("a day and month already past this year: next year's", () => {
    expect(at("10/11 09:00 x")).toEqual({ at: "2027-11-10T08:00:00.000Z", rest: "x" });
  });

  it("tomorrow across the end of a month and of a year", () => {
    expect(at("demain 08:00 x", new Date("2026-12-31T20:00:00Z"))).toEqual({
      at: "2027-01-01T07:00:00.000Z",
      rest: "x",
    });
  });

  it("tomorrow is Paris's tomorrow, even late in the UTC evening", () => {
    // 23:30 UTC on the 16th is already 00:30 on the 17th in Paris.
    expect(at("demain 09:00 x", new Date("2026-11-16T23:30:00Z"))).toEqual({
      at: "2026-11-18T08:00:00.000Z",
      rest: "x",
    });
  });
});

describe("refused, never guessed", () => {
  it.each([
    ["an hour skipped by the change of time", "2027-03-28 02:30 x", /n'existe pas ce jour-là/],
    ["an hour met twice", "2026-10-25 02:30 x", /revient deux fois/],
    ["a date that does not exist", "31/02 09:00 x", /date n'existe pas/],
    ["the 30th of February in full", "2027-02-30 09:00 x", /date n'existe pas/],
    ["hour 24", "2026-11-20 24:00 x", /date n'existe pas/],
    ["minute 60", "2026-11-20 09:60 x", /date n'existe pas/],
    ["month 13", "2026-13-01 09:00 x", /date n'existe pas/],
    ["an instant already past", "2026-11-16 09:59 x", /déjà passée/],
    ["now exactly", "2026-11-16 10:00 x", /déjà passée/],
    ["more than a year ahead", "2027-11-18 09:00 x", /plus d'un an/],
    ["dans 0", "dans 0 h x", /au moins 1/],
    ["dans 400 jours", "dans 400 j x", /plus d'un an/],
    ["a weekday", "lundi 09:00 x", /quand \?/],
    ["an hour alone", "09:00 x", /quand \?/],
    ["words", "la semaine prochaine x", /quand \?/],
    ["a date glued to the text", "2026-11-20 09:00x", /quand \?/],
    ["a time zone of its own", "2026-11-20T09:00Z x", /quand \?/],
    ["an empty text", "", /quand \?/],
  ])("%s", (_what, input, said) => {
    expect(at(input)).toMatch(said);
  });

  it("the year's bound is MAX_AHEAD_MS: 366 days still read", () => {
    expect(MAX_AHEAD_MS).toBe(366 * 86_400_000);
    expect("at" in parseWhen("dans 366 j x", NOW)).toBe(true);
  });
});

describe("the wall clock, both ways", () => {
  it("the two instants of the autumn hour are both real: refused as ambiguous", () => {
    expect(wallToInstant({ y: 2026, mo: 10, d: 25, h: 2, mi: 30 })).toBe("double");
    expect(wallToInstant({ y: 2026, mo: 10, d: 25, h: 3, mi: 0 })).toEqual(
      new Date("2026-10-25T02:00:00Z"),
    );
  });

  it("the spring hour does not exist; the one after does", () => {
    expect(wallToInstant({ y: 2027, mo: 3, d: 28, h: 2, mi: 0 })).toBe("inexistante");
    expect(wallToInstant({ y: 2027, mo: 3, d: 28, h: 3, mi: 0 })).toEqual(
      new Date("2027-03-28T01:00:00Z"),
    );
  });
});

describe("said back, in Paris time", () => {
  it("weekday, day/month and hour; the year only when it is not this one", () => {
    expect(sayWhen(new Date("2026-11-20T08:00:00Z"), NOW)).toBe("vendredi 20/11 à 09:00");
    expect(sayWhen(new Date("2027-01-04T07:05:00Z"), NOW)).toBe("lundi 04/01/2027 à 08:05");
  });
});

describe("what the review asked (P1)", () => {
  it.each([
    ["demain 9h x", "2026-11-17T08:00:00.000Z"],
    ["demain 9h30 x", "2026-11-17T08:30:00.000Z"],
    ["2026-11-20 9h x", "2026-11-20T08:00:00.000Z"],
    ["20/11/2026 09:00 x", "2026-11-20T08:00:00.000Z"],
    ["16/11 11:00 x", "2026-11-16T10:00:00.000Z"],
  ])("%s", (input, iso) => {
    expect(at(input)).toEqual({ at: iso, rest: "x" });
  });

  it("a date past earlier today is a mistake, said — never next year's", () => {
    expect(at("16/11 09:00 x")).toMatch(/déjà passée/);
  });

  it("a date with its year, already past: refused, never rolled", () => {
    expect(at("20/11/2025 09:00 x")).toMatch(/déjà passée/);
  });

  it("an hour without its minutes but with a colon is not one", () => {
    expect(at("demain 9: x")).toMatch(/quand \?/);
  });
});
