// The finding lifecycle (Legion's propositions): seen once is a candidate,
// seen again is open; gone from a check that ran is resolved; a check that
// could not run closes nothing and is itself a finding; an accepted risk
// stays quiet for its occurrence, and a new occurrence is a new finding.
// The messages: nothing changed, no message; never over Telegram's limit;
// the command comes from the catalogue, the CTO's word is marked as AI.
import { describe, expect, it } from "vitest";
import { type ActiveFinding, reconcile } from "./lifecycle.ts";
import {
  AI_NOTICE,
  formatDaily,
  formatWeekly,
  type ReportFinding,
  TELEGRAM_MAX,
} from "./report.ts";
import type { CheckResult, Observation } from "./types.ts";

const fw: Observation = {
  type: "firewall_off",
  target: "mac",
  occurrence: "off",
  severity: "moyen",
  title: "Le pare-feu de macOS est désactivé",
};
const ts = (v: string): Observation => ({
  type: "tailscale_outdated",
  target: "tailscale",
  occurrence: v,
  severity: "moyen",
  title: `Tailscale ${v}`,
});
const ran = (check: string, observations: Observation[]): CheckResult => ({
  check,
  ran: true,
  observations,
});
const active = (
  id: number,
  check: string,
  o: Observation,
  status: ActiveFinding["status"],
): ActiveFinding => ({
  id,
  check,
  status,
  type: o.type,
  target: o.target,
  occurrence: o.occurrence,
});

describe("reconcile", () => {
  it("seen for the first time: a candidate only (a passing glitch wakes nobody)", () => {
    const plan = reconcile([], [ran("firewall", [fw])]);
    expect(plan.insert.map((o) => [o.check, o.type])).toEqual([["firewall", "firewall_off"]]);
    expect([plan.promote, plan.touch, plan.resolve, plan.drop]).toEqual([[], [], [], []]);
  });

  it("seen again: the candidate opens; still seen: touched, never opened twice", () => {
    expect(
      reconcile([active(1, "firewall", fw, "candidat")], [ran("firewall", [fw])]).promote.map(
        (p) => p.id,
      ),
    ).toEqual([1]);
    const still = reconcile([active(1, "firewall", fw, "ouvert")], [ran("firewall", [fw])]);
    expect(still.touch.map((p) => p.id)).toEqual([1]);
    expect(still.insert).toEqual([]);
  });

  it("gone from a check that ran: open is resolved, a candidate dropped quietly", () => {
    const plan = reconcile(
      [active(1, "firewall", fw, "ouvert"), active(2, "tailscale", ts("1.104.1"), "candidat")],
      [ran("firewall", []), ran("tailscale", [])],
    );
    expect(plan.resolve).toEqual([1]);
    expect(plan.drop).toEqual([2]);
  });

  it("a check that could not run closes nothing, and is itself a finding", () => {
    const plan = reconcile(
      [active(1, "firewall", fw, "ouvert")],
      [{ check: "firewall", ran: false }],
    );
    expect(plan.resolve).toEqual([]);
    expect(plan.insert.map((o) => [o.type, o.target])).toEqual([["check_impossible", "firewall"]]);
  });

  it("the impossible check resolves when the check runs again", () => {
    const impossible = {
      type: "check_impossible",
      target: "firewall",
      occurrence: "-",
      severity: "moyen" as const,
      title: "x",
    };
    const plan = reconcile([active(9, "firewall", impossible, "ouvert")], [ran("firewall", [])]);
    expect(plan.resolve).toEqual([9]);
  });

  it("another check's absence says nothing about this finding", () => {
    expect(
      reconcile([active(1, "firewall", fw, "ouvert")], [ran("tailscale", [])]).resolve,
    ).toEqual([]);
  });

  it("accepted: quiet for its occurrence, never resolved by absence; a new occurrence is new", () => {
    const acc = active(3, "tailscale", ts("1.104.1"), "accepte");
    const same = reconcile([acc], [ran("tailscale", [ts("1.104.1")])]);
    expect(same.insert).toEqual([]);
    expect(same.touch.map((t) => t.id)).toEqual([3]);
    expect(reconcile([acc], [ran("tailscale", [])]).resolve).toEqual([]);
    expect(
      reconcile([acc], [ran("tailscale", [ts("1.106.0")])]).insert.map((o) => o.occurrence),
    ).toEqual(["1.106.0"]);
  });
});

const finding = (id: number, over: Partial<ReportFinding> = {}): ReportFinding => ({
  id,
  type: "firewall_off",
  target: "mac",
  occurrence: "off",
  severity: "moyen",
  title: "Le pare-feu de macOS est désactivé",
  params: {},
  firstSeen: new Date("2026-10-10T05:30:00Z"),
  ...over,
});
const NOW = new Date("2026-10-12T05:30:00Z");

describe("the messages", () => {
  it("nothing opened, nothing resolved: no message at all", () => {
    expect(formatDaily({ date: NOW, opened: [], resolved: [], openTotal: 3 })).toBeNull();
  });

  it("each new finding: the catalogue's advice and command, the CTO's word marked as AI, worst first", () => {
    const text =
      formatDaily({
        date: NOW,
        opened: [
          finding(2, {
            type: "tailscale_outdated",
            target: "tailscale",
            occurrence: "1.104.1",
            title: "Tailscale",
            severity: "faible",
          }),
          finding(1, { comment: "Tout service ouvert est joignable." }),
        ],
        resolved: [finding(7, { title: "Gatekeeper réactivé" })],
        openTotal: 2,
      }) ?? "";
    expect(text.indexOf("n°1")).toBeLessThan(text.indexOf("n°2"));
    expect(text).toContain(
      "⌨ À lancer toi-même : sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on",
    );
    expect(text).toContain("💬 CTO : Tout service ouvert est joignable.");
    expect(text).toContain("✔ Résolu · Gatekeeper réactivé (constat n°7)");
    expect(text).toContain(AI_NOTICE);
  });

  it("never over Telegram's limit; the left-out are counted, the hint is kept", () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      finding(i + 1, { title: `Constat ${"t".repeat(250)}`, comment: "c".repeat(390) }),
    );
    const text = formatDaily({ date: NOW, opened: many, resolved: [], openTotal: 60 }) ?? "";
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_MAX);
    expect(text).toMatch(/\+ \d+ autre\(s\) constat\(s\)/);
    expect(text).toMatch(/accepter <n°>/);
    expect(text.endsWith(AI_NOTICE)).toBe(true);
  });

  it("the weekly review: open findings and accepted risks with their reason", () => {
    const text = formatWeekly({
      date: NOW,
      open: [finding(1)],
      accepted: [
        { ...finding(4, { title: "Tailscale" }), reason: "mise à jour vendredi", acceptedAt: NOW },
      ],
    });
    expect(text).toMatch(/1 constat\(s\) à traiter, 0 pris en charge/);
    expect(text).toContain("raison : mise à jour vendredi");
    expect(formatWeekly({ date: NOW, open: [], accepted: [] })).toMatch(/Aucun constat ouvert/);
  });
});
