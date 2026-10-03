import { describe, expect, it } from "vitest";
import { deadline, runAlertBench } from "./bench.ts";

describe("alert bench — phase 3 exit criterion", () => {
  it("nominal: no urgent missed or late, none too many, no content, recaps on time", async () => {
    const report = await runAlertBench();
    expect(report.failures).toEqual([]);
    expect(report.urgentSignalled).toBe(report.urgentExpected);
    expect(report.urgentExpected).toBe(8);
  });

  it("Telegram down two hours on a morning: nothing is lost", async () => {
    const report = await runAlertBench([
      { from: new Date("2026-10-01T08:30:00+02:00"), to: new Date("2026-10-01T10:30:00+02:00") },
    ]);
    expect(report.missed).toEqual([]);
    expect(report.leaks).toEqual([]);
    expect(report.urgentSignalled).toBe(report.urgentExpected);
  });

  it("deadlines: 16 minutes in the day, next recap otherwise", () => {
    expect(deadline(new Date("2026-09-29T08:14:00+02:00"))).toEqual(
      new Date("2026-09-29T08:30:00+02:00"),
    );
    expect(deadline(new Date("2026-09-27T12:49:00+02:00"))).toEqual(
      new Date("2026-09-28T09:01:00+02:00"),
    );
    expect(deadline(new Date("2026-09-30T19:50:00+02:00"))).toEqual(
      new Date("2026-10-01T09:01:00+02:00"),
    );
  });
});
