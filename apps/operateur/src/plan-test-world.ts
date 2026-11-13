/**
 * The plan driver's test world (J7d): one confirmed plan and its steps in
 * memory, a store that answers as the database's does (a step launches once,
 * with its action — both or neither), and a verdict of Legion to shape.
 */
import type { PlanStep, StoredPlan, StoredServerAction } from "@cenacle/journal";
import type { Observation } from "@cenacle/securite";
import type { PlanDeps } from "./plan.ts";
import { MIN, NOW } from "./test-world.ts";

export type Step = { -readonly [K in keyof PlanStep]: PlanStep[K] };
export type Action = { -readonly [K in keyof StoredServerAction]: StoredServerAction[K] };

export const obs = (type: string, target: string): Observation => ({
  type,
  target,
  occurrence: "-",
  severity: "moyen",
  title: "x",
});

export function planWorld(
  steps: Array<[string, Step["action"], boolean]>,
  over: { confirmedAgo?: number; state?: StoredPlan["state"] } = {},
) {
  const plan = {
    id: 7,
    state: over.state ?? ("confirmee" as StoredPlan["state"]),
    createdAt: NOW,
    confirmedAt: new Date(NOW.getTime() - (over.confirmedAgo ?? MIN)),
    messageId: null,
    steps: steps.map(
      ([host, action, conditional], i): Step => ({
        id: 100 + i,
        position: i,
        host,
        action,
        conditional,
        state: "attente",
        actionId: null,
        reason: null,
      }),
    ),
  };
  const actions = new Map<number, Action>();
  const sent: string[] = [];
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  let verdictAt = NOW.getTime() - 5 * MIN;
  let etats: Record<string, string> = { "vps-b": "SOUFFRANT", "noeud-a": "SOUFFRANT" };
  let seen: Observation[] = [];
  const snapshot = (): StoredPlan => ({ ...plan, steps: plan.steps.map((s) => ({ ...s })) });
  const step = (id: number) => plan.steps.find((s) => s.id === id);
  const deps: PlanDeps = {
    active: true,
    plans: {
      running: async () => (["confirmee", "en_cours"].includes(plan.state) ? snapshot() : null),
      get: async () => snapshot(),
      start: async () => {
        plan.state = "en_cours";
        return true;
      },
      launchStep: async (id) => {
        const s = step(id);
        if (s === undefined || s.state !== "attente" || plan.state !== "en_cours") return null;
        const actionId = 500 + actions.size;
        actions.set(actionId, {
          id: actionId,
          findingId: null,
          planId: plan.id,
          host: s.host,
          action: s.action,
          state: "confirmee",
          requestedAt: NOW,
          confirmedAt: NOW,
          finishedAt: null,
          exitCode: null,
          refusal: null,
          verified: null,
          beforeCount: null,
          afterCount: null,
        });
        s.state = "lancee";
        s.actionId = actionId;
        return actionId;
      },
      settle: async (id, state, reason) => {
        const s = step(id);
        if (s === undefined || !["attente", "lancee"].includes(s.state)) return false;
        s.state = state;
        s.reason = reason;
        return true;
      },
      finish: async (_, state) => {
        plan.state = state;
        for (const s of plan.steps) if (s.state === "attente") s.state = "annulee";
        return true;
      },
      purge: async () => 0,
    },
    actions: {
      get: async (id) => actions.get(id) ?? null,
    },
    verdict: () =>
      [
        "bulletin=1",
        `instant=${Math.floor(verdictAt / 1000)}`,
        ...Object.entries(etats).map(([h, e]) => `${h}.etat=${e}`),
        "fin=1",
      ].join("\n"),
    parseVerdict: () => seen,
    send: async (text) => {
      sent.push(text);
    },
    journal: {
      append: async (e) => {
        events.push({ type: e.type, payload: e.payload ?? {} });
        return { id: 1n, occurredAt: NOW, agent: e.agent, type: e.type, payload: e.payload ?? {} };
      },
    },
    now: () => NOW,
  };
  /** The action the launched step made, ended as the operator would end it. */
  const answer = (patch: Partial<Action>) => {
    const launched = plan.steps.find((s) => s.state === "lancee");
    const a = actions.get(launched?.actionId ?? -1);
    if (a === undefined) throw new Error("nothing launched");
    Object.assign(a, patch);
  };
  return {
    deps,
    plan,
    actions,
    sent,
    events,
    answer,
    seen: (s: Observation[]) => {
      seen = s;
    },
    verdictAt: (ms: number) => {
      verdictAt = ms;
    },
    etats: (e: Record<string, string>) => {
      etats = e;
    },
  };
}
