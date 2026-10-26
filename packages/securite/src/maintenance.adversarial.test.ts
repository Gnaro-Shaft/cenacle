// The maintenance summary (J7c, ADR-0035): due from 9:00 once a local day,
// or after my /maintenance — never twice for one ask, never in the quiet
// hours unasked; a switch off unless it says exactly `true`; steps that come
// from the open findings' types alone, in serveurs.local.toml's order, "by
// hand" without a key; a restart that left only the spared ones is not
// offered again (n exactly, never n + 1, never after 7 days); a machine
// outside serveurs.local.toml said apart; nothing to do: no text at all.
import { describe, expect, it } from "vitest";
import {
  formatRecap,
  parseMaintenanceSwitch,
  type RecapFinding,
  type RecapInput,
  recapDue,
  SPARED_VALID_MS,
} from "./maintenance.ts";
import { TELEGRAM_MAX } from "./report.ts";

// Paris is UTC+1 on these dates (after the last Sunday of October).
const at = (iso: string) => new Date(iso);
const NOW = at("2026-10-27T10:00:00Z"); // 11:00 in Paris

describe("when the summary goes", () => {
  const none = { morning: null, any: null, asked: null };
  it("from 9:00 Paris, once a local day; not at 8:59; not in the quiet hours", () => {
    expect(recapDue(at("2026-10-27T07:59:00Z"), none)).toBeNull();
    expect(recapDue(at("2026-10-27T08:00:00Z"), none)).toBe("matin");
    expect(recapDue(at("2026-10-27T21:30:00Z"), none)).toBeNull(); // 22:30
    const sent = at("2026-10-27T08:01:00Z");
    expect(
      recapDue(at("2026-10-27T15:00:00Z"), { morning: sent, any: sent, asked: null }),
    ).toBeNull();
    expect(recapDue(at("2026-10-28T08:00:00Z"), { morning: sent, any: sent, asked: null })).toBe(
      "matin",
    );
  });

  it("my ask: answered once, at any hour; an ask older than the last summary is spent", () => {
    const asked = at("2026-10-27T22:30:00Z"); // 23:30, quiet hours
    expect(recapDue(at("2026-10-27T22:31:00Z"), { morning: NOW, any: NOW, asked })).toBe("demande");
    const answered = at("2026-10-27T22:31:00Z");
    expect(recapDue(at("2026-10-27T22:32:00Z"), { morning: NOW, any: answered, asked })).toBeNull();
    // Asked before 9:00 and answered: the morning one still goes.
    const early = at("2026-10-27T06:00:00Z");
    expect(
      recapDue(at("2026-10-27T08:00:00Z"), {
        morning: null,
        any: at("2026-10-27T06:01:00Z"),
        asked: early,
      }),
    ).toBe("matin");
  });
});

describe("the switch", () => {
  it("on only for exactly `true`", () => {
    expect(parseMaintenanceSwitch("[maintenance]\nactif = true\n")).toBe(true);
    for (const text of [
      "",
      "[maintenance]\nactif = false\n",
      '[maintenance]\nactif = "true"\n',
      "[maintenance]\nactif = 1\n",
      "maintenance = true\n",
      "[[maintenance]]\nactif = true\n",
      "[serveurs]\nactif = true\n",
      "[maintenance\nactif = true",
    ]) {
      expect(parseMaintenanceSwitch(text)).toBe(false);
    }
  });
});

const all = ["services", "redemarrer", "maj_securite"] as const;
const finding = (type: string, target: string, n?: number): RecapFinding => ({
  type,
  target,
  params: n === undefined ? { host: target } : { host: target, count: String(n) },
});
const input = (over: Partial<RecapInput>): RecapInput => ({
  machines: [
    { name: "vps-b", actions: [...all] },
    { name: "noeud-a", actions: [...all] },
  ],
  findings: [],
  lastRestart: new Map(),
  serversActive: true,
  now: NOW,
  ...over,
});

describe("what the summary says", () => {
  it("nothing to do: no text, no machine, no step", () => {
    expect(formatRecap(input({}))).toEqual({
      text: null,
      plan: [],
      machines: 0,
      steps: 0,
      memo: null,
    });
    // Findings that are not the servers' never count.
    expect(formatRecap(input({ findings: [finding("filevault", "vps-b")] })).text).toBeNull();
  });

  it("an update brings its conditional 🔁 and 🔄; machines in the file's order", () => {
    const r = formatRecap(
      input({
        findings: [
          finding("serveur_services", "noeud-a", 4),
          finding("serveur_maj_securite", "vps-b", 12),
        ],
      }),
    );
    expect(r.machines).toBe(2);
    expect(r.steps).toBe(2);
    const text = r.text ?? "";
    expect(text.indexOf("• vps-b")).toBeLessThan(text.indexOf("• noeud-a"));
    expect(text).toContain("⬆ mises à jour de sécurité (12 en attente)");
    expect(text).toContain("🔁 s'il le faut, après la mise à jour");
    expect(text).toContain("🔄 s'il le faut, après la mise à jour");
    expect(text).toContain("🔁 relancer les services (4)");
    expect(text).not.toMatch(/[[\]{}]/);
  });

  it("a reboot asked: said with the node to empty first", () => {
    const text = formatRecap(input({ findings: [finding("serveur_redemarrage", "noeud-a")] })).text;
    expect(text).toContain(
      "🔄 redémarrage demandé — refusé si des invités tournent : vider le nœud d'abord",
    );
  });

  it("no key for the action: by hand, and not counted as a step", () => {
    const r = formatRecap(
      input({
        machines: [{ name: "vps-b", actions: ["services", "redemarrer"] }],
        findings: [finding("serveur_maj_securite", "vps-b", 3)],
      }),
    );
    expect(r.text).toContain(
      "⬆ mises à jour de sécurité (3 en attente) — à faire à la main (aucune clé)",
    );
    expect(r.steps).toBe(0);
  });

  it("a machine outside serveurs.local.toml: said apart, by hand; once, sorted", () => {
    const r = formatRecap(
      input({
        findings: [
          finding("serveur_services", "zeta", 2),
          finding("serveur_redemarrage", "hote-legion"),
          finding("serveur_maj_securite", "hote-legion", 1),
        ],
      }),
    );
    expect(r.text).toContain("Hors Cénacle, à la main : hote-legion, zeta.");
    expect(r.machines).toBe(0);
  });

  it("the servers' switch off: said", () => {
    const text = formatRecap(
      input({ serversActive: false, findings: [finding("serveur_services", "vps-b", 2)] }),
    ).text;
    expect(text).toContain("[serveurs] actif");
  });
});

describe("a restart that left only the spared ones", () => {
  const services = (n: number) => [finding("serveur_services", "vps-b", n)];
  const restart = (exitCode: number, ago = 3_600_000) =>
    new Map([["vps-b", { exitCode, finishedAt: new Date(NOW.getTime() - ago) }]]);

  it("5 left, 5 spared (125): a memo, not something to do — no text at all", () => {
    const r = formatRecap(input({ findings: services(5), lastRestart: restart(125) }));
    expect(r.text).toBeNull();
    expect(r.memo).toContain("vps-b (5)");
  });

  it("the memo rides along when something else is to do", () => {
    const r = formatRecap(
      input({
        findings: [...services(5), finding("serveur_redemarrage", "noeud-a")],
        lastRestart: restart(125),
      }),
    );
    expect(r.text).toContain("il ne reste que les services épargnés par principe : vps-b (5)");
    expect(r.text).not.toContain("🔁 relancer");
  });

  it("6 left with 5 spared: offered again", () => {
    expect(formatRecap(input({ findings: services(6), lastRestart: restart(125) })).text).toContain(
      "🔁 relancer les services (6)",
    );
  });

  it("older than 7 days, no spared count, or no count: offered again", () => {
    for (const lastRestart of [
      restart(125, SPARED_VALID_MS + 1),
      restart(0),
      restart(12),
      new Map(),
    ]) {
      expect(formatRecap(input({ findings: services(5), lastRestart })).text).toContain(
        "🔁 relancer",
      );
    }
    const noCount = [finding("serveur_services", "vps-b")];
    expect(formatRecap(input({ findings: noCount, lastRestart: restart(125) })).text).toContain(
      "🔁 relancer les services",
    );
    const badCount = [{ ...finding("serveur_services", "vps-b"), params: { count: "5; rm" } }];
    expect(formatRecap(input({ findings: badCount, lastRestart: restart(125) })).text).toContain(
      "🔁 relancer les services",
    );
  });
});

describe("Telegram's limit", () => {
  it("never over 4096 characters; what is cut is said", () => {
    const machines = Array.from({ length: 400 }, (_, i) => ({
      name: `machine-${String(i).padStart(3, "0")}-${"x".repeat(30)}`,
      actions: [...all],
    }));
    const findings = machines.flatMap((m) => [
      finding("serveur_maj_securite", m.name, 9),
      finding("serveur_redemarrage", m.name),
    ]);
    const text = formatRecap(input({ machines, findings })).text ?? "";
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_MAX);
    expect(text).toMatch(/partie\(s\) de plus : \/constats\)$/);
  });
});
