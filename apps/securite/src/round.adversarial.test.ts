// The security agent's round (Legion's ronde), end to end with an in-memory
// store and a controlled clock: debounce over two rounds; a serious finding
// speaks at once (critical any hour, high outside quiet hours), the rest
// waits for the morning report, sent once a day; network checks at most once
// an hour, and a round without them closes none of their findings; a failed
// message goes again next round; the Monday review rides on the report; the
// journal gets counts, never a title.
import type { FindingPlan, NewEvent, SecuriteStore, StoredFinding } from "@cenacle/journal";
import type { CheckResult, Observation, Severity } from "@cenacle/securite";
import { describe, expect, it } from "vitest";
import { runRound } from "./round.ts";

type Row = StoredFinding & { so: boolean; sc: boolean };

function memoryStore(): SecuriteStore & { rows: Row[] } {
  const rows: Row[] = [];
  let next = 1;
  const set = (id: number, patch: Partial<Row>) => {
    const i = rows.findIndex((r) => r.id === id);
    if (i >= 0) rows[i] = { ...(rows[i] as Row), ...patch };
  };
  return {
    rows,
    active: async () => rows.filter((r) => r.status !== "resolu" && r.status !== "caduc"),
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
          decidedAt: null,
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
    open: async () => rows.filter((r) => r.status === "ouvert" || r.status === "pris_en_charge"),
    accepted: async () => rows.filter((r) => r.status === "accepte"),
    accept: async () => false,
    purge: async () => 0,
  };
}

const finding = (type: string, severity: Severity): Observation => ({
  type,
  target: "mac",
  occurrence: "off",
  severity,
  title: `${type} (${severity})`,
});
/** Paris is UTC+2 in October: 10:00 local is 08:00 UTC. */
const at = (local: string) => new Date(`${local}+02:00`);

function world(local: Observation[], network: Observation[] = []) {
  const store = memoryStore();
  const sent: { text: string; buttons: readonly number[] }[] = [];
  const events: (NewEvent & { at: Date })[] = [];
  const networkRuns: Date[] = [];
  let now = at("2026-10-10T10:00:00");
  let failSend = false;
  const latest = (type: string, net?: boolean) =>
    events
      .filter((e) => e.type === type && (net === undefined || e.payload?.network === net))
      .at(-1)?.at ?? null;
  const deps = {
    checks: async (withNetwork: boolean): Promise<CheckResult[]> => {
      const out: CheckResult[] = [{ check: "local", ran: true, observations: local }];
      if (withNetwork) {
        networkRuns.push(now);
        out.push({ check: "net", ran: true, observations: network });
      }
      return out;
    },
    store,
    comment: async () => "Explication du CTO.",
    send: async (text: string, buttons: readonly number[]) => {
      if (failSend) throw new Error("Telegram unreachable");
      sent.push({ text, buttons });
    },
    journal: {
      append: async (e: NewEvent) => {
        events.push({ ...e, at: now });
        return { id: 1n, occurredAt: now, agent: e.agent, type: e.type, payload: e.payload ?? {} };
      },
      read: async () => [],
    },
    now: () => now,
    lastNetwork: async () => latest("securite.ran", true),
    lastReport: async () => latest("securite.rapport"),
    lastWeekly: async () => latest("securite.bilan"),
  };
  return {
    deps,
    store,
    sent,
    events,
    networkRuns,
    at: (when: string) => {
      now = at(when);
    },
    failing: (f: boolean) => {
      failSend = f;
    },
    local,
  };
}

describe("speaking at once, or waiting for the morning", () => {
  it("high, in the day: told at the second round, with its buttons; not again in the report", async () => {
    const w = world([finding("sip_off", "eleve")]);
    await runRound(w.deps);
    expect(w.sent).toEqual([]);
    w.at("2026-10-10T10:15:00");
    expect(await runRound(w.deps)).toMatchObject({ urgent: 1, report: false });
    expect(w.sent[0]?.buttons).toEqual([1]);
    w.at("2026-10-11T07:30:00");
    await runRound(w.deps);
    expect(w.sent.filter((s) => s.text.includes("sip_off"))).toHaveLength(1);
  });

  it("medium: never at once, told by the next morning report", async () => {
    const w = world([finding("firewall_off", "moyen")]);
    await runRound(w.deps);
    w.at("2026-10-10T10:15:00");
    await runRound(w.deps);
    expect(w.sent).toEqual([]);
    w.at("2026-10-11T07:30:00");
    expect(await runRound(w.deps)).toMatchObject({ report: true, opened: 1 });
    expect(w.sent[0]?.text).toContain("firewall_off");
  });

  it("high at night waits for the morning; critical at night speaks at once", async () => {
    const high = world([finding("sip_off", "eleve")]);
    high.at("2026-10-10T23:00:00");
    await runRound(high.deps);
    high.at("2026-10-10T23:15:00");
    await runRound(high.deps);
    expect(high.sent).toEqual([]);
    high.at("2026-10-11T07:30:00");
    await runRound(high.deps);
    expect(high.sent[0]?.text).toContain("sip_off");

    const critical = world([finding("filevault_off", "critique")]);
    critical.at("2026-10-10T23:00:00");
    await runRound(critical.deps);
    critical.at("2026-10-10T23:15:00");
    expect(await runRound(critical.deps)).toMatchObject({ urgent: 1 });
  });

  it("the morning report once a day, however many rounds; none before 7:30", async () => {
    const w = world([]);
    w.at("2026-10-11T07:15:00");
    expect((await runRound(w.deps)).report).toBe(false);
    for (const t of ["07:30", "07:45", "08:00", "12:00", "21:45"]) {
      w.at(`2026-10-11T${t}:00`);
      await runRound(w.deps);
    }
    expect(w.events.filter((e) => e.type === "securite.rapport")).toHaveLength(1);
    w.at("2026-10-12T07:30:00");
    await runRound(w.deps);
    expect(w.events.filter((e) => e.type === "securite.rapport")).toHaveLength(2);
  });
});

describe("the network checks", () => {
  it("at most once an hour", async () => {
    const w = world([]);
    for (const t of ["10:00", "10:15", "10:30", "10:59", "11:00", "11:15"]) {
      w.at(`2026-10-10T${t}:00`);
      await runRound(w.deps);
    }
    expect(w.networkRuns.map((d) => d.toISOString())).toEqual([
      at("2026-10-10T10:00:00").toISOString(),
      at("2026-10-10T11:00:00").toISOString(),
    ]);
  });

  it("a round without them closes none of their findings", async () => {
    const w = world([], [finding("tailscale_outdated", "moyen")]);
    await runRound(w.deps);
    w.at("2026-10-10T11:00:00");
    await runRound(w.deps);
    expect(w.store.rows[0]?.status).toBe("ouvert");
    w.at("2026-10-10T11:15:00");
    await runRound(w.deps);
    expect(w.store.rows[0]?.status).toBe("ouvert");
  });
});

describe("what must not be lost", () => {
  it("an urgent message that fails goes again next round", async () => {
    const w = world([finding("sip_off", "eleve")]);
    await runRound(w.deps);
    w.failing(true);
    w.at("2026-10-10T10:15:00");
    await expect(runRound(w.deps)).rejects.toThrow(/Telegram/);
    w.failing(false);
    w.at("2026-10-10T10:30:00");
    await runRound(w.deps);
    expect(w.sent.filter((s) => s.text.includes("sip_off"))).toHaveLength(1);
  });

  it("resolved is told in the morning report", async () => {
    const w = world([finding("sip_off", "eleve")]);
    await runRound(w.deps);
    w.at("2026-10-10T10:15:00");
    await runRound(w.deps);
    w.local.length = 0;
    w.at("2026-10-10T10:30:00");
    await runRound(w.deps);
    w.at("2026-10-11T07:30:00");
    await runRound(w.deps);
    expect(w.sent.at(-1)?.text).toMatch(/✔ Résolu · sip_off/);
  });

  it("the Monday review rides on the morning report, once", async () => {
    const w = world([]);
    // Monday 7:15, before the report: no review yet.
    w.at("2026-10-12T07:15:00");
    expect((await runRound(w.deps)).weekly).toBe(false);
    w.at("2026-10-12T07:30:00");
    expect((await runRound(w.deps)).weekly).toBe(true);
    w.at("2026-10-12T07:45:00");
    expect((await runRound(w.deps)).weekly).toBe(false);
    expect(w.sent.filter((s) => s.text.includes("Bilan sécurité"))).toHaveLength(1);
  });

  it("the journal gets counts only, never a title", async () => {
    const w = world([finding("sip_off", "eleve")]);
    await runRound(w.deps);
    w.at("2026-10-10T10:15:00");
    await runRound(w.deps);
    expect(w.sent).toHaveLength(1);
    expect(w.events.at(-1)?.payload).toMatchObject({ checks: 1, network: false, urgent: 1 });
    expect(JSON.stringify(w.events)).not.toMatch(/sip_off/);
  });
});
