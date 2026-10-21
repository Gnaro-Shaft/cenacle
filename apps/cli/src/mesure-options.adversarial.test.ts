// The options of mesure:rangement: --depuis is a real calendar day, read as
// midnight in Paris (summer and winter time alike); a bad value stops the
// measure with a clear message, it never silently measures everything.
import { UsageError } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import { arrivedSince, parseMeasureOptions, parseSince } from "./mesure-options.ts";

describe("parseMeasureOptions", () => {
  it("nothing given: every mail, no replay", () => {
    expect(parseMeasureOptions([])).toEqual({
      max: Number.POSITIVE_INFINITY,
      simulate: false,
      since: null,
    });
  });

  it("all three together, in any order", () => {
    const o = parseMeasureOptions(["--depuis", "2026-10-22", "--simuler", "--max", "40"]);
    expect(o.max).toBe(40);
    expect(o.simulate).toBe(true);
    expect(o.since?.day).toBe("2026-10-22");
  });

  it.each([
    ["--depuis without a value", ["--depuis"]],
    ["--depuis followed by another option", ["--depuis", "--simuler"]],
    ["--max without a value", ["--max"]],
    ["--max zero", ["--max", "0"]],
    ["--max negative", ["--max", "-3"]],
    ["--max not a number", ["--max", "dix"]],
  ])("%s: refused", (_label, argv) => {
    expect(() => parseMeasureOptions(argv)).toThrow(UsageError);
  });
});

describe("parseSince", () => {
  it.each([
    "22/10/2026",
    "2026-10-22T00:00",
    "2026-1-2",
    " 2026-10-22",
    "2026-02-30",
    "2026-13-01",
    "2026-00-10",
    "2025-02-29",
    "aujourd'hui",
    "",
  ])("refuses %j", (day) => {
    expect(() => parseSince(day)).toThrow(/AAAA-MM-JJ réelle/);
  });

  it("a leap day is a real day", () => {
    expect(parseSince("2028-02-29").day).toBe("2028-02-29");
  });

  it.each([
    ["summer time (UTC+2)", "2026-10-22", "2026-10-21T22:00:00.000Z"],
    ["winter time (UTC+1), the day after the change", "2026-10-26", "2026-10-25T23:00:00.000Z"],
    [
      "the day of the change, midnight still in summer time",
      "2026-10-25",
      "2026-10-24T22:00:00.000Z",
    ],
    ["the spring change", "2027-03-28", "2027-03-27T23:00:00.000Z"],
  ])("midnight in Paris — %s", (_label, day, instant) => {
    expect(new Date(parseSince(day).at).toISOString()).toBe(instant);
  });
});

describe("arrivedSince", () => {
  const since = parseSince("2026-10-22");
  it.each([
    ["00:30 in Paris on the 22nd (22:30 UTC on the 21st)", "2026-10-21T22:30:00.000Z", true],
    ["exactly midnight in Paris", "2026-10-21T22:00:00.000Z", true],
    ["one millisecond before", "2026-10-21T21:59:59.999Z", false],
    ["23:30 in Paris on the 21st", "2026-10-21T21:30:00.000Z", false],
    ["days later", "2026-10-30T09:00:00.000Z", true],
  ])("%s → %s", (_label, at, expected) => {
    expect(arrivedSince(at, since)).toBe(expected);
  });

  it("without --depuis, every mail", () => {
    expect(arrivedSince("1999-01-01T00:00:00.000Z", null)).toBe(true);
  });

  it("an unreadable date is not counted as recent", () => {
    expect(arrivedSince("pas une date", since)).toBe(false);
  });
});
