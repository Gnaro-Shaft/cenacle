// An event of the agenda (ADR-0042, points 2 and 4): only the title and the
// times come out, whatever else the server sends; a time that cannot be placed
// is set aside with a reason from the list, never an excerpt; a whole day stays
// its date; the window and the hours hold around the changes of hour, and a
// time missing or doubled by one follows RFC 5545.
import { describe, expect, it } from "vitest";
import { cleanTitle, MAX_TITLE, meetsWindow, readCalendarData } from "./ical.ts";
import { caldavUtc, canonicalZone, localToInstant, windowOf } from "./times.ts";

const cal = (...event: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", ...event, "END:VEVENT", "END:VCALENDAR"].join(
    "\r\n",
  );
const one = (...event: string[]) => {
  const reads = readCalendarData(cal(...event));
  expect(reads).toHaveLength(1);
  return reads[0];
};
const utc = (s: string) => Date.parse(s);

describe("only the title and the times come out", () => {
  it("attendees, organiser, place, description, attachments: read past, never returned", () => {
    const read = one(
      "UID:secret-uid-123",
      "SUMMARY:Point projet",
      "DTSTART:20261117T090000Z",
      "DTEND:20261117T100000Z",
      "ORGANIZER;CN=Jeanne Tiers:mailto:jeanne.tiers@exemple.test",
      "ATTENDEE;CN=Paul Invité:mailto:paul@exemple.test",
      "LOCATION:12 rue Secrète",
      "DESCRIPTION:Code d'accès 4321",
      "ATTACH:https://exemple.test/piece.pdf",
    );
    expect(read).toEqual({
      ok: true,
      event: {
        kind: "heure",
        title: "Point projet",
        start: utc("2026-11-17T09:00:00Z"),
        end: utc("2026-11-17T10:00:00Z"),
      },
    });
    const text = JSON.stringify(read);
    for (const leak of ["Jeanne", "Paul", "Secrète", "4321", "piece", "secret-uid"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("an alarm's own summary is not the event's", () => {
    const reads = readCalendarData(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "DTSTART:20261117T090000Z",
        "BEGIN:VALARM",
        "SUMMARY:Texte de l'alarme",
        "DTSTART:20200101T000000Z",
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n"),
    );
    const at = utc("2026-11-17T09:00:00Z");
    expect(reads).toEqual([{ ok: true, event: { kind: "heure", title: "", start: at, end: at } }]);
  });

  it("the title: folded lines joined, escapes undone, a quoted colon in a parameter kept apart", () => {
    const read = one(
      'SUMMARY;ALTREP="cid:x:y";LANGUAGE=fr:Réunion\\, budget\\; suite\\nfin',
      " de la ligne",
      "DTSTART:20261117T090000Z",
    );
    expect(read).toMatchObject({
      ok: true,
      event: { title: "Réunion, budget; suite finde la ligne" },
    });
  });

  it("control and direction characters removed, the title bounded", () => {
    expect(cleanTitle("A\u0007B‮evil⁦C\tD")).toBe("A B evil C D");
    expect(Array.from(cleanTitle("é".repeat(500)))).toHaveLength(MAX_TITLE);
    // Never a lone half of a surrogate pair at the cut.
    expect(Array.from(cleanTitle("😀".repeat(300))).every((c) => c === "😀")).toBe(true);
  });
});

describe("set aside with a reason from the list, never an excerpt", () => {
  it.each([
    ["a floating time", ["DTSTART:20261117T090000"], "heure-flottante"],
    [
      "an unknown zone (a Windows name)",
      ["DTSTART;TZID=Romance Standard Time:20261117T090000"],
      "fuseau-inconnu",
    ],
    [
      "a series not expanded",
      ["DTSTART:20261117T090000Z", "RRULE:FREQ=WEEKLY"],
      "serie-non-etendue",
    ],
    ["no start", ["SUMMARY:x"], "illisible"],
    ["a start twice", ["DTSTART:20261117T090000Z", "DTSTART:20261118T090000Z"], "illisible"],
    ["a 31 February", ["DTSTART:20270231T090000Z"], "illisible"],
    ["25 o'clock", ["DTSTART:20261117T250000Z"], "illisible"],
    [
      "an end before the start",
      ["DTSTART:20261117T090000Z", "DTEND:20261117T080000Z"],
      "illisible",
    ],
    [
      "both an end and a duration",
      ["DTSTART:20261117T090000Z", "DTEND:20261117T100000Z", "DURATION:PT1H"],
      "illisible",
    ],
    ["a negative duration", ["DTSTART:20261117T090000Z", "DURATION:-PT1H"], "illisible"],
    [
      "an end in an unknown zone",
      ["DTSTART:20261117T090000Z", "DTEND;TZID=Nowhere/Land:20261117T100000"],
      "fuseau-inconnu",
    ],
  ])("%s: %s", (_, lines, reason) => {
    const read = one("SUMMARY:Rendez-vous avec M. Untel", ...lines);
    expect(read).toEqual({ ok: false, reason });
    expect(JSON.stringify(read)).not.toContain("Untel");
  });

  it("a broken structure: unreadable, the events before it kept", () => {
    const reads = readCalendarData(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "DTSTART:20261117T090000Z",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "END:VTODO",
      ].join("\n"),
    );
    expect(reads).toHaveLength(2);
    expect(reads[1]).toEqual({ ok: false, reason: "illisible" });
  });
});

describe("a whole day stays its date", () => {
  it("DTEND is exclusive: one day, then three", () => {
    expect(one("DTSTART;VALUE=DATE:20261117", "DTEND;VALUE=DATE:20261118")).toEqual({
      ok: true,
      event: { kind: "journee", title: "", first: "2026-11-17", last: "2026-11-17" },
    });
    expect(one("DTSTART;VALUE=DATE:20261230", "DTEND;VALUE=DATE:20270102")).toMatchObject({
      event: { first: "2026-12-30", last: "2027-01-01" },
    });
  });

  it("without an end, one day; with a duration of days, those days", () => {
    expect(one("DTSTART;VALUE=DATE:20261117")).toMatchObject({
      event: { first: "2026-11-17", last: "2026-11-17" },
    });
    expect(one("DTSTART;VALUE=DATE:20261117", "DURATION:P2D")).toMatchObject({
      event: { last: "2026-11-18" },
    });
  });

  it("a date end for a timed start, or the reverse: unreadable", () => {
    expect(one("DTSTART;VALUE=DATE:20261117", "DTEND:20261118T000000Z")).toEqual({
      ok: false,
      reason: "illisible",
    });
    expect(one("DTSTART:20261117T090000Z", "DTEND;VALUE=DATE:20261118")).toEqual({
      ok: false,
      reason: "illisible",
    });
  });
});

describe("the changes of hour (Paris: 28 March 2027 forward, 25 October 2026 back)", () => {
  it("a time in a known zone is converted", () => {
    expect(one("DTSTART;TZID=Europe/Paris:20261117T090000")).toMatchObject({
      event: { start: utc("2026-11-17T08:00:00Z") },
    });
    expect(one('DTSTART;TZID="America/New_York":20260717T090000')).toMatchObject({
      event: { start: utc("2026-07-17T13:00:00Z") },
    });
  });

  it("a time that does not exist is read with the offset before the gap (RFC 5545, § 3.3.5)", () => {
    expect(localToInstant({ y: 2027, m: 3, d: 28, h: 2, min: 30, s: 0 }, "Europe/Paris")).toBe(
      utc("2027-03-28T01:30:00Z"),
    );
    expect(localToInstant({ y: 2027, m: 3, d: 14, h: 2, min: 30, s: 0 }, "America/New_York")).toBe(
      utc("2027-03-14T07:30:00Z"),
    );
  });

  it("a time that exists twice is its first occurrence", () => {
    expect(localToInstant({ y: 2026, m: 10, d: 25, h: 2, min: 30, s: 0 }, "Europe/Paris")).toBe(
      utc("2026-10-25T00:30:00Z"),
    );
    // Just outside the overlap, each side is itself.
    expect(localToInstant({ y: 2026, m: 10, d: 25, h: 1, min: 59, s: 0 }, "Europe/Paris")).toBe(
      utc("2026-10-24T23:59:00Z"),
    );
    expect(localToInstant({ y: 2026, m: 10, d: 25, h: 3, min: 0, s: 0 }, "Europe/Paris")).toBe(
      utc("2026-10-25T02:00:00Z"),
    );
  });

  it("the window runs midnight to midnight: 23 hours, then 25", () => {
    const spring = windowOf(utc("2027-03-28T10:00:00Z"), 1);
    expect([spring.start, spring.end]).toEqual([
      utc("2027-03-27T23:00:00Z"),
      utc("2027-03-28T22:00:00Z"),
    ]);
    const autumn = windowOf(utc("2026-10-25T10:00:00Z"), 1);
    expect([autumn.start, autumn.end]).toEqual([
      utc("2026-10-24T22:00:00Z"),
      utc("2026-10-25T23:00:00Z"),
    ]);
    // 23:30 UTC on the 16th is already the 17th in Paris; 22:30 is still the 16th.
    expect(windowOf(utc("2026-11-16T23:30:00Z"), 7).from).toEqual({ y: 2026, m: 11, d: 17 });
    expect(windowOf(utc("2026-11-16T22:30:00Z"), 7).from).toEqual({ y: 2026, m: 11, d: 16 });
  });

  it("a duration of days keeps the local hour across the change; hours are exact", () => {
    expect(one("DTSTART;TZID=Europe/Paris:20261024T090000", "DURATION:P1D")).toMatchObject({
      event: { start: utc("2026-10-24T07:00:00Z"), end: utc("2026-10-25T08:00:00Z") },
    });
    expect(one("DTSTART;TZID=Europe/Paris:20261024T090000", "DURATION:PT24H")).toMatchObject({
      event: { end: utc("2026-10-25T07:00:00Z") },
    });
  });

  it("zones: IANA names known, others not", () => {
    expect(canonicalZone("Europe/Paris")).toBe("Europe/Paris");
    // Case variants are one zone: what is used next is the canonical name, never the text received.
    expect(canonicalZone("europe/PARIS")).toBe("Europe/Paris");
    expect(canonicalZone("Romance Standard Time")).toBeNull();
    expect(canonicalZone("/mozilla.org/20050126_1/Europe/Paris")).toBeNull();
    expect(canonicalZone("+01")).toBeNull(); // an offset is not an IANA name
    expect(canonicalZone("-05:00")).toBeNull();
    expect(canonicalZone("")).toBeNull();
    expect(caldavUtc(utc("2026-11-17T08:05:09.123Z"))).toBe("20261117T080509Z");
  });
});

describe("the window", () => {
  const w = {
    start: utc("2026-11-16T23:00:00Z"),
    end: utc("2026-11-17T23:00:00Z"),
    first: "2026-11-17",
    last: "2026-11-17",
  };
  it("an event met by the window is kept, one beside it is not", () => {
    const at = (s: string, e: string) => ({
      kind: "heure" as const,
      title: "",
      start: utc(s),
      end: utc(e),
    });
    expect(meetsWindow(at("2026-11-16T22:00:00Z", "2026-11-17T00:00:00Z"), w)).toBe(true);
    expect(meetsWindow(at("2026-11-16T22:00:00Z", "2026-11-16T23:00:00Z"), w)).toBe(false);
    expect(meetsWindow(at("2026-11-17T23:00:00Z", "2026-11-17T23:00:00Z"), w)).toBe(false);
    expect(meetsWindow(at("2026-11-16T23:00:00Z", "2026-11-16T23:00:00Z"), w)).toBe(true);
    const day = (first: string, last: string) => ({
      kind: "journee" as const,
      title: "",
      first,
      last,
    });
    expect(meetsWindow(day("2026-11-10", "2026-11-17"), w)).toBe(true);
    expect(meetsWindow(day("2026-11-18", "2026-11-18"), w)).toBe(false);
  });
});
