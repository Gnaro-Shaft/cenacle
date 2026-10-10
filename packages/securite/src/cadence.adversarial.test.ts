// When the agent speaks (Legion's ronde): quiet hours from 22 h to 7 h, Paris
// time, in summer and in winter; critical always speaks, high only outside
// quiet hours, the rest never at once; the morning report from 7:30, once per
// local day; the network checks at most once an hour.
import { describe, expect, it } from "vitest";
import { isQuiet, networkDue, reportDue, urgentNow } from "./cadence.ts";

const summer = (t: string) => new Date(`2026-07-15T${t}+02:00`);
const winter = (t: string) => new Date(`2026-01-15T${t}+01:00`);

describe("quiet hours, 22 h to 7 h in Paris", () => {
  it.each([
    [summer, "21:59:00", false],
    [summer, "22:00:00", true],
    [summer, "06:59:00", true],
    [summer, "07:00:00", false],
    [winter, "21:59:00", false],
    [winter, "22:00:00", true],
    [winter, "06:59:00", true],
    [winter, "07:00:00", false],
  ])("%#: %s is quiet: %s", (when, t, quiet) => {
    expect(isQuiet(when(t))).toBe(quiet);
  });
});

describe("who speaks at once", () => {
  it("critical at any hour; high only outside quiet hours; never the others", () => {
    expect(urgentNow("critique", summer("03:00:00"))).toBe(true);
    expect(urgentNow("eleve", summer("03:00:00"))).toBe(false);
    expect(urgentNow("eleve", summer("10:00:00"))).toBe(true);
    for (const s of ["moyen", "faible", "info"] as const) {
      expect(urgentNow(s, summer("10:00:00"))).toBe(false);
    }
  });
});

describe("the morning report", () => {
  it("from 7:30, once per local day, never at night", () => {
    expect(reportDue(summer("07:29:00"), null)).toBe(false);
    expect(reportDue(summer("07:30:00"), null)).toBe(true);
    expect(reportDue(summer("21:59:00"), null)).toBe(true);
    expect(reportDue(summer("22:30:00"), null)).toBe(false);
    expect(reportDue(summer("12:00:00"), summer("07:31:00"))).toBe(false);
    expect(reportDue(new Date("2026-07-16T07:30:00+02:00"), summer("07:31:00"))).toBe(true);
  });

  it("the local day, not the UTC one: 00:30 in Paris is still the day before in UTC", () => {
    // Sent at 07:30 Paris on the 15th; at 07:30 on the 16th it is due again.
    const sent = summer("07:30:00");
    expect(reportDue(new Date("2026-07-16T07:30:00+02:00"), sent)).toBe(true);
    expect(reportDue(winter("07:45:00"), winter("07:30:00"))).toBe(false);
  });
});

describe("the network checks", () => {
  it("at most once an hour", () => {
    const t = summer("10:00:00");
    expect(networkDue(t, null)).toBe(true);
    expect(networkDue(new Date(t.getTime() + 59 * 60_000), t)).toBe(false);
    expect(networkDue(new Date(t.getTime() + 60 * 60_000), t)).toBe(true);
  });
});
