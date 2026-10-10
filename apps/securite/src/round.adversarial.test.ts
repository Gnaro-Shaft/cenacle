// One round of the security agent, end to end with an in-memory store: the
// first sighting sends nothing (debounce); the second sends the finding;
// a message that fails to leave is sent again next round; the weekly review
// goes on Mondays only, once; the local model away leaves the round going;
// the journal gets counts, never a title.
import type { FindingPlan, NewEvent, SecuriteStore, StoredFinding } from "@cenacle/journal";
import type { CheckResult } from "@cenacle/securite";
import { describe, expect, it } from "vitest";
import { runRound } from "./round.ts";

function memoryStore(): SecuriteStore & { rows: (StoredFinding & { so: boolean; sc: boolean })[] } {
  const rows: (StoredFinding & { so: boolean; sc: boolean })[] = [];
  let next = 1;
  const set = (id: number, patch: Partial<(typeof rows)[number]>) => {
    const i = rows.findIndex((r) => r.id === id);
    if (i >= 0) rows[i] = { ...(rows[i] as (typeof rows)[number]), ...patch };
  };
  return {
    rows,
    active: async () => rows.filter((r) => ["candidat", "ouvert", "accepte"].includes(r.status)),
    apply: async (plan: FindingPlan, now) => {
      for (const o of plan.insert) {
        rows.push({
          id: next++,
          ...o,
          params: o.params ?? {},
          status: "candidat",
          firstSeen: now,
          lastSeen: now,
          closedAt: null,
          reason: null,
          acceptedAt: null,
          so: false,
          sc: false,
        });
      }
      for (const p of plan.promote) set(p.id, { status: "ouvert", lastSeen: now });
      for (const p of plan.touch) set(p.id, { lastSeen: now });
      for (const id of plan.resolve) set(id, { status: "resolu", closedAt: now });
      for (const id of plan.drop) set(id, { status: "caduc", closedAt: now });
    },
    toSignal: async () => ({
      opened: rows.filter((r) => r.status === "ouvert" && !r.so),
      resolved: rows.filter((r) => r.status === "resolu" && r.so && !r.sc),
    }),
    markSignaled: async (o, r) => {
      for (const id of o) set(id, { so: true });
      for (const id of r) set(id, { sc: true });
    },
    open: async () => rows.filter((r) => r.status === "ouvert"),
    accepted: async () => rows.filter((r) => r.status === "accepte"),
    accept: async () => false,
    purge: async () => 0,
  };
}

const firewallOff: CheckResult = {
  check: "firewall",
  ran: true,
  observations: [
    {
      type: "firewall_off",
      target: "mac",
      occurrence: "off",
      severity: "moyen",
      title: "Le pare-feu de macOS est désactivé",
    },
  ],
};
const SATURDAY = new Date("2026-10-10T05:30:00Z");
const day = (d: Date, n: number) => new Date(d.getTime() + n * 24 * 3_600_000);

function world(results: () => CheckResult[]) {
  const store = memoryStore();
  const sent: string[] = [];
  const events: NewEvent[] = [];
  let now = SATURDAY;
  let failSend = false;
  let lastWeekly: Date | null = null;
  const deps = {
    checks: async () => results(),
    store,
    comment: async () => "Explication du CTO.",
    send: async (t: string) => {
      if (failSend) throw new Error("Telegram unreachable");
      sent.push(t);
    },
    journal: {
      append: async (e: NewEvent) => {
        events.push(e);
        if (e.type === "securite.bilan") lastWeekly = now;
        return { id: 1n, occurredAt: now, agent: e.agent, type: e.type, payload: e.payload ?? {} };
      },
      read: async () => [],
    },
    now: () => now,
    lastWeekly: async () => lastWeekly,
  };
  return {
    deps,
    store,
    sent,
    events,
    at: (d: Date) => {
      now = d;
    },
    failing: (f: boolean) => {
      failSend = f;
    },
  };
}

describe("a round", () => {
  it("first sighting: nothing sent; second: the finding, with the CTO's word and the command", async () => {
    const w = world(() => [firewallOff]);
    await runRound(w.deps);
    expect(w.sent).toEqual([]);
    w.at(day(SATURDAY, 1));
    const out = await runRound(w.deps);
    expect(out).toMatchObject({ opened: 1, open: 1 });
    expect(w.sent[0]).toContain("Le pare-feu de macOS est désactivé");
    expect(w.sent[0]).toContain("💬 CTO : Explication du CTO.");
    expect(w.sent[0]).toContain("⌨ À lancer toi-même");
  });

  it("a message that fails to leave is sent again next round, never lost", async () => {
    const w = world(() => [firewallOff]);
    await runRound(w.deps);
    w.failing(true);
    w.at(day(SATURDAY, 1));
    await expect(runRound(w.deps)).rejects.toThrow(/Telegram/);
    w.failing(false);
    // Sunday: no weekly review either.
    await runRound(w.deps);
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]).toContain("pare-feu");
  });

  it("told once: the next rounds say nothing until it changes; then 'resolved'", async () => {
    let fixed = false;
    const w = world(() => [
      fixed ? { check: "firewall", ran: true, observations: [] } : firewallOff,
    ]);
    await runRound(w.deps);
    w.at(day(SATURDAY, 1));
    await runRound(w.deps);
    await runRound(w.deps);
    expect(w.sent).toHaveLength(1);
    fixed = true;
    await runRound(w.deps);
    expect(w.sent[1]).toMatch(/✔ Résolu · Le pare-feu/);
  });

  it("the weekly review on Monday only, once", async () => {
    const w = world(() => []);
    w.at(day(SATURDAY, 2));
    expect((await runRound(w.deps)).weekly).toBe(true);
    expect((await runRound(w.deps)).weekly).toBe(false);
    w.at(day(SATURDAY, 3));
    expect((await runRound(w.deps)).weekly).toBe(false);
    expect(w.sent.filter((t) => t.includes("Bilan sécurité"))).toHaveLength(1);
  });

  it("the local model away: the finding still goes, without a word from the CTO", async () => {
    const w = world(() => [firewallOff]);
    const deps = { ...w.deps, comment: async () => null };
    await runRound(deps);
    w.at(day(SATURDAY, 1));
    await runRound(deps);
    expect(w.sent[0]).toContain("pare-feu");
    expect(w.sent[0]).not.toContain("💬");
  });

  it("the journal gets counts only, never a title", async () => {
    const w = world(() => [firewallOff, { check: "tailscale", ran: false }]);
    await runRound(w.deps);
    w.at(day(SATURDAY, 1));
    await runRound(w.deps);
    expect(w.sent[0]).toContain("pare-feu");
    const ran = w.events.findLast((e) => e.type === "securite.ran");
    expect(ran?.payload).toMatchObject({ checks: 2, impossible: 1 });
    expect(JSON.stringify(w.events)).not.toMatch(/pare-feu|tailscale/i);
  });
});
