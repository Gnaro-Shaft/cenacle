import { describe, expect, it } from "vitest";
import { workingHoursBetween, zonedMidnight } from "./working-hours.ts";

const P = "Europe/Paris";
const h = (a: string, b: string) => workingHoursBetween(new Date(a), new Date(b), P);

describe("working hours (Europe/Paris)", () => {
  it("counts a plain weekday span", () => {
    expect(h("2026-09-29T08:00:00+02:00", "2026-10-01T10:00:00+02:00")).toBe(50);
  });

  it("skips the whole weekend: Friday 17 h → Tuesday 17 h is 48 h", () => {
    expect(h("2026-09-25T17:00:00+02:00", "2026-09-29T17:00:00+02:00")).toBe(48);
  });

  it("counts nothing inside a weekend", () => {
    expect(h("2026-09-26T09:00:00+02:00", "2026-09-27T22:00:00+02:00")).toBe(0);
  });

  it("a mail received on Saturday starts counting on Monday at midnight", () => {
    expect(h("2026-09-26T10:00:00+02:00", "2026-09-28T10:00:00+02:00")).toBe(10);
  });

  it("follows the clock change (Sunday 25/10/2026: 03:00 → 02:00)", () => {
    // Friday 12:00 to Monday 12:00 across the change: Friday 12 h + Monday 12 h.
    expect(h("2026-10-23T12:00:00+02:00", "2026-10-26T12:00:00+01:00")).toBe(24);
    expect(zonedMidnight(2026, 10, 26, P)).toBe(Date.parse("2026-10-25T23:00:00Z"));
  });

  it("is 0 when the end is not after the start", () => {
    expect(h("2026-10-01T10:00:00Z", "2026-10-01T09:00:00Z")).toBe(0);
  });
});
