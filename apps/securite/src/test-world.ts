// The security agent's round under test (J6a–J6e2): an in-memory store with
// the database's rules, a controlled clock and recorded messages, shared by
// the round's adversarial tests.
import type { FindingPlan, NewEvent, SecuriteStore, StoredFinding } from "@cenacle/journal";
import type { CheckResult, Observation, Severity } from "@cenacle/securite";
export type Row = StoredFinding & { so: boolean; sc: boolean };

export function memoryStore(): SecuriteStore & { rows: Row[] } {
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
          actionState: null,
          actionPrUrl: null,
          actionHeadSha: null,
          actionDelegated: false,
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
    pendingFixes: async () => rows.filter((r) => r.actionState === "demandee"),
    openPullRequests: async () => rows.filter((r) => r.actionState === "pr_ouverte"),
    prRequests: async () => [],
    delegateFix: async () => false,
    actionCounts: async () => ({
      prepared: 0,
      mergedClean: 0,
      mergedEdited: 0,
      closed: 0,
      ciFailed: 0,
    }),
    setAction: async (id, state, prUrl) =>
      set(id, { actionState: state, actionPrUrl: prUrl ?? null }),
  };
}

export const finding = (type: string, severity: Severity): Observation => ({
  type,
  target: "mac",
  occurrence: "off",
  severity,
  title: `${type} (${severity})`,
});
/** Paris is UTC+2 in October: 10:00 local is 08:00 UTC. */
export const at = (local: string) => new Date(`${local}+02:00`);

export function world(local: Observation[], network: Observation[] = []) {
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
