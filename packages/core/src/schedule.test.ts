import { describe, expect, it } from "vitest";
import { collectDue, isQuiet, latestRecapSlot, recapToSend } from "./schedule.ts";

const d = (iso: string) => new Date(iso);

describe("schedule (Europe/Paris)", () => {
  it.each([
    ["2026-10-01T07:59:00+02:00", true],
    ["2026-10-01T08:00:00+02:00", false],
    ["2026-10-01T19:59:00+02:00", false],
    ["2026-10-01T20:00:00+02:00", true],
    ["2026-10-03T11:00:00+02:00", true], // Saturday
    ["2026-10-04T11:00:00+02:00", true], // Sunday
  ])("isQuiet(%s) = %s", (iso, quiet) => {
    expect(isQuiet(d(iso))).toBe(quiet);
  });

  it("collects every 15 minutes in the day, never in quiet hours", () => {
    const at = d("2026-10-01T10:00:00+02:00");
    expect(collectDue(at, null)).toBe(true);
    expect(collectDue(at, d("2026-10-01T09:50:00+02:00"))).toBe(false);
    expect(collectDue(at, d("2026-10-01T09:45:00+02:00"))).toBe(true);
    expect(collectDue(d("2026-10-01T22:00:00+02:00"), null)).toBe(false);
  });

  it("finds the latest recap slot of the day", () => {
    expect(latestRecapSlot(d("2026-10-01T08:30:00+02:00"))).toBeNull();
    expect(latestRecapSlot(d("2026-10-01T09:00:00+02:00"))).toEqual(d("2026-10-01T09:00:00+02:00"));
    expect(latestRecapSlot(d("2026-10-01T17:59:00+02:00"))).toEqual(d("2026-10-01T13:00:00+02:00"));
    expect(latestRecapSlot(d("2026-10-01T23:00:00+02:00"))).toEqual(d("2026-10-01T18:00:00+02:00"));
    expect(latestRecapSlot(d("2026-10-03T10:00:00+02:00"))).toBeNull();
  });

  it("sends each recap once, late if the Mac slept, and skips the ones it missed", () => {
    const nine = d("2026-10-01T09:00:00+02:00");
    expect(recapToSend(d("2026-10-01T09:01:00+02:00"), null)).toEqual(nine);
    expect(recapToSend(d("2026-10-01T09:30:00+02:00"), nine)).toBeNull();
    // Mac asleep from 8 h to 14 h: only the 13 h recap is sent, not the 9 h one.
    expect(recapToSend(d("2026-10-01T14:00:00+02:00"), d("2026-09-30T18:00:00+02:00"))).toEqual(
      d("2026-10-01T13:00:00+02:00"),
    );
  });

  it("keeps 9 h local on the day the clock changes", () => {
    expect(latestRecapSlot(d("2026-10-26T09:30:00+01:00"))).toEqual(d("2026-10-26T09:00:00+01:00"));
  });
});
