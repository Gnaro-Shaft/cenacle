// From a reading to what Telegram may receive (ADR-0042, point 7): hours and
// counts per Paris day, never a title — even a title shaped like an hour;
// the hours hold around a change of hour; an event begun the day before, a
// whole day over several days, and a crowded day are counted, not lost; a
// faulty configuration is said without its reason.
import { describe, expect, it } from "vitest";
import { hoursOf } from "./heures.ts";
import type { AgendaEvent, AgendaView } from "./lecture.ts";
import { decodeAnswer, encodeLine, MAX_ANSWER, MAX_HOURS_PER_DAY } from "./prise-protocole.ts";

const TRAP = "RDV M. Untel 09:00 — confidentiel";
const at = (iso: string) => Date.parse(iso);
const timed = (start: string, end: string, title = TRAP): AgendaEvent => ({
  kind: "heure",
  title,
  start: at(start),
  end: at(end),
  account: "pro",
});
const whole = (first: string, last: string): AgendaEvent => ({
  kind: "journee",
  title: TRAP,
  first,
  last,
  account: "perso",
});
const view = (events: AgendaEvent[], extra: Partial<AgendaView & { read: "ok" }> = {}) =>
  ({
    read: "ok",
    from: "2026-11-17",
    days: 7,
    accounts: [
      { name: "pro", state: "ok" },
      { name: "perso", state: "ok" },
    ],
    events,
    setAside: [],
    ...extra,
  }) as AgendaView;

describe("the hours of a day", () => {
  it("are the Paris start times, sorted, and no title ever comes out", () => {
    const out = hoursOf(
      view([
        timed("2026-11-18T13:30:00Z", "2026-11-18T14:00:00Z"),
        timed("2026-11-18T08:00:00Z", "2026-11-18T09:00:00Z"),
        timed("2026-11-17T08:00:00Z", "2026-11-17T09:00:00Z"), // today: not tomorrow
        whole("2026-11-18", "2026-11-18"),
      ]),
      "2026-11-18",
      1,
    );
    expect(out).toEqual({
      read: "ok",
      days: [{ date: "2026-11-18", hours: ["09:00", "14:30"], more: 0, wholeDays: 1, ongoing: 0 }],
      failures: [],
      setAside: 0,
    });
    const wire = JSON.stringify(out);
    expect(wire).not.toContain("Untel");
    expect(wire).not.toContain("RDV");
  });

  it("hold on the day the clocks go back (25 hours) and the day they go forward", () => {
    // 25/10/2026: midnight is 22:00Z the day before; 23:30 Paris is 22:30Z.
    const autumn = hoursOf(
      view([
        timed("2026-10-24T22:00:00Z", "2026-10-24T22:30:00Z"),
        timed("2026-10-25T22:30:00Z", "2026-10-25T22:45:00Z"),
        timed("2026-10-25T23:00:00Z", "2026-10-25T23:30:00Z"), // 00:00 on the 26th
      ]),
      "2026-10-25",
      1,
    );
    expect(autumn.read === "ok" && autumn.days[0]?.hours).toEqual(["00:00", "23:30"]);
    // 29/03/2026: 03:00 Paris is 01:00Z; midnight of the 30th is 22:00Z.
    const spring = hoursOf(
      view([
        timed("2026-03-29T01:00:00Z", "2026-03-29T02:00:00Z"),
        timed("2026-03-29T21:59:00Z", "2026-03-29T22:10:00Z"),
        timed("2026-03-29T22:00:00Z", "2026-03-29T22:10:00Z"),
      ]),
      "2026-03-29",
      1,
    );
    expect(spring.read === "ok" && spring.days[0]?.hours).toEqual(["03:00", "23:59"]);
  });

  it("count an event begun the day before, and not one that ended at midnight", () => {
    const out = hoursOf(
      view([
        timed("2026-11-17T21:00:00Z", "2026-11-18T01:00:00Z"), // 22:00 → 02:00
        timed("2026-11-17T21:00:00Z", "2026-11-17T23:00:00Z"), // ends at midnight
      ]),
      "2026-11-18",
      1,
    );
    expect(out.read === "ok" && out.days[0]).toMatchObject({ hours: [], ongoing: 1 });
  });

  it("count a whole day on each of its days, its last one included", () => {
    const out = hoursOf(view([whole("2026-11-16", "2026-11-19")]), "2026-11-17", 4);
    expect(out.read === "ok" && out.days.map((d) => d.wholeDays)).toEqual([1, 1, 1, 0]);
    expect(out.read === "ok" && out.days.map((d) => d.date)).toEqual([
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
    ]);
  });

  it("a crowded day shows its first hours and counts the rest, within the answer's size", () => {
    const events = Array.from({ length: 5000 }, (_, i) =>
      timed(
        new Date(at("2026-11-18T00:00:00Z") + i * 10_000).toISOString(),
        "2026-11-18T23:00:00Z",
      ),
    );
    const out = hoursOf(view(events), "2026-11-18", 7);
    expect(out.read === "ok" && out.days[0]?.hours.length).toBe(MAX_HOURS_PER_DAY);
    expect(out.read === "ok" && out.days[0]?.more).toBe(5000 - MAX_HOURS_PER_DAY);
    expect(() => decodeAnswer(encodeLine(out, MAX_ANSWER).trim())).not.toThrow();
  });
});

describe("what surrounds the hours", () => {
  it("an account down is named with its word; set-aside events are summed", () => {
    const out = hoursOf(
      view([], {
        accounts: [
          { name: "pro", state: "injoignable" },
          { name: "perso", state: "ok" },
          { name: "autre", state: "config" },
        ],
        setAside: [
          { account: "perso", reason: "heure-flottante", count: 2 },
          { account: "perso", reason: "trop-nombreux", count: 3 },
        ],
      }),
      "2026-11-18",
      1,
    );
    expect(out.read === "ok" && out.failures).toEqual([
      { account: "pro", state: "injoignable" },
      { account: "autre", state: "config" },
    ]);
    expect(out.read === "ok" && out.setAside).toBe(5);
  });

  it("a faulty configuration says 'config' and keeps its reason for the page", () => {
    const out = hoursOf({ read: "config", why: "deux comptes nommés « pro »" }, "", 1);
    expect(out).toEqual({ read: "config" });
    expect(hoursOf({ read: "absent" }, "", 1)).toEqual({ read: "absent" });
  });

  it("more days than the week is refused", () => {
    expect(() => hoursOf(view([]), "2026-11-17", 8)).toThrow(RangeError);
    expect(() => hoursOf(view([]), "2026-11-17", 0)).toThrow(RangeError);
  });
});
