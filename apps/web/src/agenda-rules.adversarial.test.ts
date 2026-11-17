// The Agenda tab's rules (ADR-0042, point 6): Paris days whatever the
// machine's zone, a whole day on each day it covers, an appointment begun
// before the window shown on its first day, hours that hold across a change of
// hour and a night, and words for every failure and reason the server may say.
import { describe, expect, it } from "vitest";
import { addDay, daysOf, FAILURE_LABEL, hoursOf, parisDay, REASON_LABEL } from "./agenda-rules.ts";
import type { AgendaEvent } from "./api.ts";

const at = (iso: string) => Date.parse(iso);
const timed = (start: string, end: string, title = "x"): AgendaEvent & { kind: "heure" } => ({
  kind: "heure",
  account: "pro",
  title,
  start: at(start),
  end: at(end),
});

describe("days and hours, in Paris", () => {
  it("the Paris day of an instant, not the machine's", () => {
    expect(parisDay(at("2026-11-16T23:30:00Z"))).toBe("2026-11-17");
    expect(parisDay(at("2026-11-16T22:59:59Z"))).toBe("2026-11-16");
    expect(parisDay(at("2026-07-16T22:30:00Z"))).toBe("2026-07-17");
    expect(addDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDay("2027-03-27", 1)).toBe("2027-03-28");
  });

  it("hours: a span, a point, across midnight, ending at midnight", () => {
    expect(hoursOf(timed("2026-11-17T08:00:00Z", "2026-11-17T09:30:00Z"))).toBe("09:00–10:30");
    expect(hoursOf(timed("2026-11-17T08:00:00Z", "2026-11-17T08:00:00Z"))).toBe("09:00");
    expect(hoursOf(timed("2026-11-17T22:00:00Z", "2026-11-18T00:00:00Z"))).toMatch(
      /^23:00 → .*18 01:00$/,
    );
    expect(hoursOf(timed("2026-11-17T21:00:00Z", "2026-11-17T23:00:00Z"))).toBe("22:00–00:00");
  });

  it("the hours hold on the nights the hour changes", () => {
    // 28 March 2027: 01:30 then 03:30 in Paris, one hour apart.
    expect(hoursOf(timed("2027-03-28T00:30:00Z", "2027-03-28T01:30:00Z"))).toBe("01:30–03:30");
    // 25 October 2026: 02:30 summer time, then 02:30 winter time.
    expect(hoursOf(timed("2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"))).toBe("02:30–02:30");
  });
});

describe("the days of the window", () => {
  const events: AgendaEvent[] = [
    { kind: "journee", account: "pro", title: "Salon", first: "2026-11-16", last: "2026-11-18" },
    timed("2026-11-16T20:00:00Z", "2026-11-17T09:00:00Z", "Commencé hier"),
    timed("2026-11-17T08:00:00Z", "2026-11-17T09:00:00Z", "Matin"),
    timed("2026-11-18T23:30:00Z", "2026-11-19T00:30:00Z", "Minuit et demi"),
  ];
  const days = daysOf("2026-11-17", 3, events);

  it("every day of the window, even an empty one, in order, named in French", () => {
    expect(days.map((d) => d.day)).toEqual(["2026-11-17", "2026-11-18", "2026-11-19"]);
    expect(days[0]?.label).toBe("mardi 17 novembre");
  });

  it("a whole day on each day it covers within the window", () => {
    expect(days.map((d) => d.allDay.length)).toEqual([1, 1, 0]);
  });

  it("an appointment begun before the window on its first day; 00:30 Paris on its own day", () => {
    expect(days[0]?.timed.map((e) => e.title)).toEqual(["Commencé hier", "Matin"]);
    expect(days[1]?.timed).toEqual([]);
    expect(days[2]?.timed.map((e) => e.title)).toEqual(["Minuit et demi"]);
  });

  it("a title is passed as is: the page shows it as text, never as markup", () => {
    const hostile = timed("2026-11-17T08:00:00Z", "2026-11-17T09:00:00Z", "<img src=x onerror=1>");
    expect(daysOf("2026-11-17", 1, [hostile])[0]?.timed[0]?.title).toBe("<img src=x onerror=1>");
  });
});

describe("every word the server may say has its words on the page", () => {
  it("failures and reasons: each one, none empty", () => {
    for (const word of ["refus", "injoignable", "delai", "illisible", "hote", "config"] as const) {
      expect(FAILURE_LABEL[word].length).toBeGreaterThan(5);
    }
    for (const r of [
      "fuseau-inconnu",
      "heure-flottante",
      "serie-non-etendue",
      "illisible",
      "trop-nombreux",
    ] as const) {
      expect(REASON_LABEL[r].length).toBeGreaterThan(3);
    }
    // A refusal and an outage read apart.
    expect(FAILURE_LABEL.refus).not.toBe(FAILURE_LABEL.injoignable);
  });
});
