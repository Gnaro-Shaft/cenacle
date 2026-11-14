// The Parc tab's rules (14/11): a server is never shown healthy when its
// verdict is missing or stale; a quiet security agent is said late.
import { describe, expect, it } from "vitest";
import { ago, parkTone, ROUND_LATE_MS, roundLate, severityTone, stateTone } from "./parc-rules.ts";

const NONE = { critique: 0, eleve: 0, moyen: 0, faible: 0, info: 0 } as const;
const NOW = Date.parse("2026-11-14T18:00:00Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("never healthy by default", () => {
  it("a stale verdict: every server unknown, the healthy one too", () => {
    expect(stateTone("SAIN", true)).toBe("inconnu");
    expect(stateTone("MALADE", true)).toBe("inconnu");
    expect(stateTone("SAIN", false)).toBe("bon");
  });

  it.each([
    ["no verdict", { read: "missing" }],
    ["an unreadable verdict", { read: "unreadable" }],
    ["a stale healthy verdict", { read: "ok", stale: true, state: "SAIN" as const }],
  ])("the park with %s is unknown, not healthy", (_what, servers) => {
    expect(parkTone(servers, NONE)).toBe("inconnu");
  });

  it("the worst known decides: a critical finding outweighs healthy servers", () => {
    const ok = { read: "ok", stale: false, state: "SAIN" as const };
    expect(parkTone(ok, NONE)).toBe("bon");
    expect(parkTone(ok, { ...NONE, critique: 1 })).toBe("mauvais");
    expect(parkTone(ok, { ...NONE, moyen: 2 })).toBe("attention");
    expect(parkTone({ ...ok, state: "MALADE" }, NONE)).toBe("mauvais");
    // Low and info alone never colour the park.
    expect(parkTone(ok, { ...NONE, faible: 3, info: 9 })).toBe("bon");
  });

  it("high and critical findings are red, medium amber", () => {
    expect(severityTone("critique")).toBe("mauvais");
    expect(severityTone("eleve")).toBe("mauvais");
    expect(severityTone("moyen")).toBe("attention");
  });
});

describe("time", () => {
  it.each([
    [30_000, "à l'instant"],
    [5 * 60_000, "il y a 5 min"],
    [3 * 3_600_000, "il y a 3 h"],
    [5 * 86_400_000, "il y a 5 j"],
    [-10 * 60_000, "à l'instant"],
  ])("%d ms ago: %s", (msAgo, words) => {
    expect(ago(iso(msAgo), NOW)).toBe(words);
  });

  it("a date that is no date is said unknown", () => {
    expect(ago("hier", NOW)).toBe("à une date inconnue");
  });

  it("the security agent is late past 40 min, or when its date is unreadable", () => {
    expect(roundLate(iso(ROUND_LATE_MS - 60_000), NOW)).toBe(false);
    expect(roundLate(iso(ROUND_LATE_MS + 60_000), NOW)).toBe(true);
    expect(roundLate("jamais", NOW)).toBe(true);
  });
});
