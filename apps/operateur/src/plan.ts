/**
 * The maintenance plan, driven by the operator (ADR-0035, J7d): at each pass,
 * before the actions run, it reads the confirmed plan and moves it on — one
 * step at a time, one machine at a time, in the plan's order. A step that ran
 * waits for its proof; a proved one lets the next go. Before launching a
 * step, Legion's verdict is read again (charter, rule 5): the problem gone, or
 * never come for an "if needed" step, the step is skipped, never a failure.
 * Two reboots never follow each other unproved: a reboot waits until no
 * cluster lacks its quorum and every machine of the plan answers. A stale
 * verdict waits; six hours after my confirmation, what has not started is
 * cancelled. At the first hitch the whole rest is cancelled, and said.
 * The step itself is an ordinary action: the operator checks it again and
 * the server's script keeps its own refusals. No model anywhere.
 */
import type {
  Journal,
  PlanStep,
  PlanStore,
  ServeurActions,
  StoredPlan,
  StoredServerAction,
} from "@cenacle/journal";
import { PLAN_VALID_HOURS } from "@cenacle/journal";
import {
  hostAnswered,
  motifPresent,
  type Observation,
  SERVER_CATALOGUE,
  verdictInstant,
} from "@cenacle/securite";
import {
  machineDone,
  planEnded,
  planExpired,
  planStarted,
  planStopped,
  planSwitchedOff,
} from "./plan-messages.ts";
import { FRESH_VERDICT_MS } from "./run.ts";

export interface PlanDeps {
  /** `[maintenance] actif` of securite.toml. */
  readonly active: boolean;
  readonly plans: Pick<
    PlanStore,
    "running" | "get" | "start" | "launch" | "settle" | "finish" | "purge"
  >;
  readonly actions: Pick<ServeurActions, "enqueueForPlan" | "get">;
  readonly verdict: () => string | null;
  readonly parseVerdict: (raw: string, nowMs: number) => Observation[];
  readonly send: (text: string) => Promise<void>;
  readonly journal: Pick<Journal, "append">;
  readonly now: () => Date;
}

/** What a step's action says: wait, settle it, or stop the plan. */
type Outcome =
  | { readonly kind: "wait" }
  | { readonly kind: "settle"; readonly state: "faite" | "sautee"; readonly reason: string | null }
  | { readonly kind: "stop"; readonly reason: string };

const WAIT: Outcome = { kind: "wait" };
/** A proof that lets the plan go on: gone, or only the spared services left (ADR-0035, point 7). */
const PROVED = new Set(["disparu", "epargnes"]);
const AHEAD_MS = 5 * 60_000;
const MAX_MOVES = 50;

export function outcomeOf(a: StoredServerAction | null): Outcome {
  if (a === null) return { kind: "stop", reason: "action_disparue" };
  switch (a.state) {
    case "demandee":
    case "confirmee":
    case "en_cours":
      return WAIT;
    case "faite":
      if (a.verified === null) return WAIT;
      return PROVED.has(a.verified)
        ? { kind: "settle", state: "faite", reason: null }
        : { kind: "stop", reason: `preuve_${a.verified}` };
    case "rien_a_faire":
      return { kind: "settle", state: "sautee", reason: "rien_a_faire" };
    case "refusee":
      // The operator found the problem gone between my plan and its pass: nothing to do.
      return a.refusal === "plus_de_motif"
        ? { kind: "settle", state: "sautee", reason: "plus_de_motif" }
        : { kind: "stop", reason: `refus_${a.refusal ?? "inconnu"}`.slice(0, 40) };
    case "refusee_serveur":
      return { kind: "stop", reason: "refus_serveur" };
    case "echouee":
      return {
        kind: "stop",
        reason: a.exitCode === -1 ? "etat_inconnu" : a.exitCode === 255 ? "injoignable" : "echec",
      };
    default:
      return { kind: "stop", reason: "expiree" };
  }
}

async function record(deps: PlanDeps, payload: Record<string, string | number>): Promise<void> {
  await deps.journal.append({ agent: "operateur", type: "maintenance.plan", payload });
}
async function cardState(deps: PlanDeps, to: "acting" | "idle"): Promise<void> {
  await deps.journal.append({ agent: "operateur", type: "state.changed", payload: { to } });
}

/** The machines a plan still acts on (what I removed does not count). */
const hosts = (plan: StoredPlan) => [
  ...new Set(plan.steps.filter((s) => s.state !== "retiree").map((s) => s.host)),
];
const waiting = (plan: StoredPlan, host: string) =>
  plan.steps.some((s) => s.host === host && (s.state === "attente" || s.state === "lancee"));

/** The verdict, when it is fresh and readable — else null: the plan waits. */
function freshVerdict(deps: PlanDeps, nowMs: number): { raw: string; seen: Observation[] } | null {
  const raw = deps.verdict();
  const at = raw === null ? null : verdictInstant(raw);
  if (raw === null || at === null || nowMs - at > FRESH_VERDICT_MS || at - nowMs > AHEAD_MS) {
    return null;
  }
  try {
    return { raw, seen: deps.parseVerdict(raw, nowMs) };
  } catch {
    return null;
  }
}

/** A reboot may go: no cluster without quorum, every machine of the plan seen and answering. */
function rebootMayGo(plan: StoredPlan, v: { raw: string; seen: Observation[] }): boolean {
  if (v.seen.some((o) => o.type === "serveur_quorum")) return false;
  return hosts(plan).every((h) => hostAnswered(v.raw, v.seen, h));
}

async function end(
  deps: PlanDeps,
  plan: StoredPlan,
  state: "terminee" | "arretee" | "expiree",
  reason: string | null,
  text: (p: StoredPlan) => string,
): Promise<void> {
  await deps.plans.finish(plan.id, state, reason, deps.now());
  await deps.send(text((await deps.plans.get(plan.id)) ?? plan));
  await cardState(deps, "idle");
  await record(deps, { quoi: state, raison: reason ?? "-" });
}

/** Settles a step and, its machine done, says so. */
async function settled(
  deps: PlanDeps,
  step: PlanStep,
  state: "faite" | "sautee",
  reason: string | null,
): Promise<StoredPlan | null> {
  await deps.plans.settle(step.id, state, reason);
  await record(deps, { quoi: "etape", action: step.action, resultat: state });
  const fresh = await deps.plans.running();
  if (fresh !== null && !waiting(fresh, step.host)) await deps.send(machineDone(fresh, step.host));
  return fresh;
}

/** One pass: moves the running plan on as far as it can go now. */
export async function drivePlan(deps: PlanDeps): Promise<void> {
  await deps.plans.purge(deps.now());
  let plan = await deps.plans.running();
  if (plan === null) return;
  if (!deps.active) {
    await end(deps, plan, "arretee", "interrupteur", planSwitchedOff);
    return;
  }
  if (plan.state === "confirmee") {
    await deps.plans.start(plan.id);
    await cardState(deps, "acting");
    await deps.send(planStarted(plan));
    await record(deps, {
      quoi: "lance",
      etapes: plan.steps.filter((s) => s.state === "attente").length,
    });
  }
  for (let moves = 0; plan !== null && moves < MAX_MOVES; moves++) {
    const current = plan.steps.find((s) => s.state === "lancee");
    if (current !== undefined) {
      const action = current.actionId === null ? null : await deps.actions.get(current.actionId);
      const outcome = outcomeOf(action);
      if (outcome.kind === "wait") return;
      if (outcome.kind === "stop") {
        await deps.plans.settle(current.id, "arretee", outcome.reason);
        await end(deps, plan, "arretee", outcome.reason, (p) => {
          const step = p.steps.find((s) => s.id === current.id) ?? current;
          return `${machineDone(p, current.host)}\n${planStopped(p, step, outcome.reason)}`;
        });
        return;
      }
      plan = await settled(deps, current, outcome.state, outcome.reason);
      continue;
    }
    const next = plan.steps.find((s) => s.state === "attente");
    if (next === undefined) {
      await end(deps, plan, "terminee", null, planEnded);
      return;
    }
    const nowMs = deps.now().getTime();
    if (nowMs - (plan.confirmedAt?.getTime() ?? nowMs) > PLAN_VALID_HOURS * 3_600_000) {
      await end(deps, plan, "expiree", null, planExpired);
      return;
    }
    const v = freshVerdict(deps, nowMs);
    if (v === null) return; // a stale verdict proves nothing: wait
    if (!motifPresent(v.seen, next.host, SERVER_CATALOGUE[next.action].finding)) {
      plan = await settled(deps, next, "sautee", "plus_de_motif");
      continue;
    }
    if (next.action === "redemarrer" && !rebootMayGo(plan, v)) return;
    const id = await deps.actions.enqueueForPlan(plan.id, next.host, next.action, deps.now());
    await deps.plans.launch(next.id, id);
    await record(deps, { quoi: "lancee", action: next.action });
    return; // the operator runs it in this same pass
  }
}
