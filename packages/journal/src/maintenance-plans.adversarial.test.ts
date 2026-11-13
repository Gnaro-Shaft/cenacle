// The maintenance plans, in the real database (J7d): a newer summary replaces
// a plan I did not confirm; "Retirer" and "Valider" need the button token and
// work only before I confirm; the confirmation needs its own token, within its
// 2 minutes, once — and never beside a running plan, which the database
// refuses; a step moves only forward; the end cancels what had not started;
// a plan's action belongs to the plan, never to a finding as well; a plan
// goes 365 days on, never while it runs.
import { afterAll, describe, expect, it } from "vitest";
import { createPlanStore } from "./maintenance-plans.ts";
import { createServeurActions } from "./serveur-actions.ts";
import { appConnection } from "./test-db.ts";

const sql = appConnection();
afterAll(async () => {
  // Leave no plan running for another run of these tests.
  await sql`update maintenance_plans set state = 'arretee', finished_at = now()
            where state in ('confirmee', 'en_cours')`;
  await sql.end();
});
const plans = createPlanStore(sql);
const actions = createServeurActions(sql);
const T0 = new Date("2026-10-27T08:00:00Z");
const S = 1000;
const STEPS = [
  { host: "vps-b", action: "maj_securite" as const, conditional: false },
  { host: "vps-b", action: "services" as const, conditional: true },
  { host: "vps-b", action: "redemarrer" as const, conditional: true },
  { host: "noeud-a", action: "services" as const, conditional: false },
];
const stateOf = async (id: number) => (await plans.get(id))?.state;
/** Ends whatever runs, so each test starts with the way free. */
const freeTheWay = () =>
  sql`update maintenance_plans set state = 'arretee', finished_at = now()
      where state in ('confirmee', 'en_cours')`;

describe("proposing, removing, asking", () => {
  it("a newer summary replaces the plan I did not confirm, its tokens void", async () => {
    const old = await plans.propose(STEPS, T0);
    const fresh = await plans.propose(STEPS, T0);
    expect(await stateOf(old.id)).toBe("remplacee");
    expect(await plans.ask(old.id, old.token, T0)).toBeNull();
    expect(await plans.remove(old.id, old.token, "vps-b", null)).toBe(false);
    expect(await stateOf(fresh.id)).toBe("proposee");
    expect((await plans.get(fresh.id))?.steps.map((s) => s.state)).toEqual(
      Array(4).fill("attente"),
    );
  });

  it("no step, or more than 100: refused", async () => {
    await expect(plans.propose([], T0)).rejects.toThrow();
    await expect(plans.propose(Array(101).fill(STEPS[0]), T0)).rejects.toThrow();
  });

  it("'Retirer': the reboot alone, or the whole machine, only with the button token", async () => {
    const p = await plans.propose(STEPS, T0);
    expect(await plans.remove(p.id, "0".repeat(16), "vps-b", "redemarrer")).toBe(false);
    expect(await plans.remove(p.id, "x';--", "vps-b", null)).toBe(false);
    expect(await plans.remove(p.id, p.token, "vps-b", "redemarrer")).toBe(true);
    expect((await plans.get(p.id))?.steps.map((s) => s.state)).toEqual([
      "attente",
      "attente",
      "retiree",
      "attente",
    ]);
    expect(await plans.remove(p.id, p.token, "noeud-a", null)).toBe(true);
    // Twice: nothing left to remove.
    expect(await plans.remove(p.id, p.token, "noeud-a", null)).toBe(false);
  });

  it("'Valider' with every step removed: nothing to confirm", async () => {
    const p = await plans.propose(STEPS, T0);
    await plans.remove(p.id, p.token, "vps-b", null);
    await plans.remove(p.id, p.token, "noeud-a", null);
    expect(await plans.ask(p.id, p.token, T0)).toBeNull();
  });
});

describe("the confirmation", () => {
  it("its own token, within 2 minutes, once; a stale or foreign token never", async () => {
    await freeTheWay();
    const p = await plans.propose(STEPS, T0);
    const token = await plans.ask(p.id, p.token, T0);
    if (token === null) throw new Error("no confirmation token");
    expect(token).toMatch(/^[0-9a-f]{16}$/);
    expect(await plans.confirm(p.id, p.token, T0)).toBe("stale"); // the button's, not the confirmation's
    expect(await plans.confirm(p.id, "not-a-token", T0)).toBe("stale");
    expect(await plans.confirm(p.id, token, new Date(T0.getTime() + 121 * S))).toBe("expired");
    expect(await plans.confirm(p.id, token, new Date(T0.getTime() + 120 * S))).toBe("done");
    expect(await plans.confirm(p.id, token, T0)).toBe("already");
    const confirmed = await plans.get(p.id);
    expect(confirmed).toMatchObject({ state: "confirmee" });
    expect(confirmed?.confirmedAt?.getTime()).toBe(T0.getTime() + 120 * S);
    // Confirmed: nothing more can be removed.
    expect(await plans.remove(p.id, p.token, "vps-b", null)).toBe(false);
  });

  it("never two plans running: the second confirmation is refused by the database", async () => {
    await freeTheWay();
    const first = await plans.propose(STEPS, T0);
    const t1 = await plans.ask(first.id, first.token, T0);
    expect(await plans.confirm(first.id, t1 ?? "", T0)).toBe("done");
    const second = await plans.propose(STEPS, T0);
    const t2 = await plans.ask(second.id, second.token, T0);
    expect(await plans.confirm(second.id, t2 ?? "", T0)).toBe("busy");
    expect((await plans.running())?.id).toBe(first.id);
  });

  it("a newer summary never replaces a confirmed plan", async () => {
    const running = await plans.running();
    if (running === null) throw new Error("expected the running plan");
    await plans.propose(STEPS, T0);
    expect(await stateOf(running.id)).toBe("confirmee");
  });
});

describe("driving the plan", () => {
  it("start once; a step moves only forward; the end cancels what waited", async () => {
    const p = await plans.running();
    if (p === null) throw new Error("expected the running plan");
    expect(await plans.start(p.id)).toBe(true);
    expect(await plans.start(p.id)).toBe(false);
    const [a, b, , d] = p.steps;
    if (a === undefined || b === undefined || d === undefined) throw new Error("steps");
    const actionId = await plans.launchStep(a.id, T0);
    if (actionId === null) throw new Error("the step did not launch");
    expect(await plans.launchStep(a.id, T0)).toBeNull();
    expect((await plans.get(p.id))?.steps[0]).toMatchObject({ state: "lancee", actionId });
    expect(await plans.settle(a.id, "faite", null)).toBe(true);
    expect(await plans.settle(a.id, "arretee", "x")).toBe(false);
    expect(await plans.settle(b.id, "sautee", "plus_de_motif")).toBe(true);
    await expect(plans.settle(d.id, "faite", "Pas une raison")).rejects.toThrow();
    expect(await plans.finish(p.id, "arretee", "preuve_toujours_la", T0)).toBe(true);
    expect(await plans.finish(p.id, "terminee", null, T0)).toBe(false);
    const ended = await plans.get(p.id);
    expect(ended?.state).toBe("arretee");
    expect(ended?.steps.map((s) => s.state)).toEqual(["faite", "sautee", "annulee", "annulee"]);
    expect(await plans.running()).toBeNull();
    await sql`update serveur_actions set state = 'expiree', finished_at = now() where id = ${actionId}`;
  });
});

describe("a step and its action: both or neither", () => {
  /** A confirmed, started plan, the way free. */
  async function startedPlan() {
    await freeTheWay();
    const p = await plans.propose(STEPS, T0);
    const t = await plans.ask(p.id, p.token, T0);
    expect(await plans.confirm(p.id, t ?? "", T0)).toBe("done");
    expect(await plans.start(p.id)).toBe(true);
    const plan = await plans.get(p.id);
    if (plan === null) throw new Error("the plan vanished");
    return plan;
  }
  const actionsOf = async (planId: number) =>
    (
      await sql<{ n: number }[]>`
        select count(*)::int as n from serveur_actions where plan_id = ${planId}`
    )[0]?.n;
  /** Leaves no action to run for the other tests' operator. */
  const settleActions = (planId: number) =>
    sql`update serveur_actions set state = 'expiree', finished_at = now()
        where plan_id = ${planId} and state = 'confirmee'`;

  it("runnable at once, tied to the plan alone, read from the step; never a finding as well", async () => {
    const plan = await startedPlan();
    const step = plan.steps[1];
    if (step === undefined) throw new Error("steps");
    const id = await plans.launchStep(step.id, T0);
    if (id === null) throw new Error("the step did not launch");
    expect(await actions.get(id)).toMatchObject({
      state: "confirmee",
      planId: plan.id,
      findingId: null,
      host: "vps-b",
      action: "services",
    });
    await expect(
      sql`insert into serveur_actions (host, action, state, requested_at, confirm_until)
          values ('vps-b', 'services', 'demandee', now(), now() + interval '1 minute')`,
    ).rejects.toThrow();
    await settleActions(plan.id);
  });

  it("two passes launching the same step at once: one action, never two", async () => {
    const plan = await startedPlan();
    const step = plan.steps[0];
    if (step === undefined) throw new Error("steps");
    const made = await Promise.all([
      plans.launchStep(step.id, T0),
      plans.launchStep(step.id, T0),
      plans.launchStep(step.id, T0),
    ]);
    expect(made.filter((id) => id !== null)).toHaveLength(1);
    expect(await actionsOf(plan.id)).toBe(1);
    await settleActions(plan.id);
  });

  it("the action cannot be made: the step is not launched either — and the database refuses a second one to run", async () => {
    const plan = await startedPlan();
    const step = plan.steps[0];
    if (step === undefined) throw new Error("steps");
    // An action already to run for this very step (what a cut between two statements used to leave).
    await sql`insert into serveur_actions
                (plan_id, host, action, state, requested_at, confirm_until, confirmed_at)
              values (${plan.id}, ${step.host}, ${step.action}, 'confirmee', now(),
                      now() + interval '1 second', now())`;
    await expect(plans.launchStep(step.id, T0)).rejects.toThrow(/one_pending_per_plan/);
    expect((await plans.get(plan.id))?.steps[0]).toMatchObject({
      state: "attente",
      actionId: null,
    });
    expect(await actionsOf(plan.id)).toBe(1);
    await settleActions(plan.id);
  });

  it("a plan that does not run, a removed step, an unknown step: nothing is made", async () => {
    await freeTheWay();
    const p = await plans.propose(STEPS, T0);
    const proposed = await plans.get(p.id);
    const first = proposed?.steps[0];
    if (first === undefined) throw new Error("steps");
    expect(await plans.launchStep(first.id, T0)).toBeNull(); // not confirmed
    const t = await plans.ask(p.id, p.token, T0);
    expect(await plans.remove(p.id, p.token, "noeud-a", null)).toBe(true);
    expect(await plans.confirm(p.id, t ?? "", T0)).toBe("done");
    expect(await plans.launchStep(first.id, T0)).toBeNull(); // confirmed, not started
    expect(await plans.start(p.id)).toBe(true);
    const removed = proposed?.steps[3];
    if (removed === undefined) throw new Error("steps");
    expect(await plans.launchStep(removed.id, T0)).toBeNull();
    expect(await plans.launchStep(2 ** 40, T0)).toBeNull();
    expect(await actionsOf(p.id)).toBe(0);
    expect(await plans.finish(p.id, "arretee", "essai", T0)).toBe(true);
    expect(await plans.launchStep(first.id, T0)).toBeNull(); // ended
  });
});

describe("the purge", () => {
  it("365 days after the plan, with its steps; never a plan still running", async () => {
    await freeTheWay();
    const old = new Date(T0.getTime() - 366 * 86_400_000);
    const gone = await plans.propose(STEPS, old);
    const kept = await plans.propose(STEPS, old);
    const t = await plans.ask(kept.id, kept.token, old);
    await plans.confirm(kept.id, t ?? "", old);
    expect(await plans.purge(T0)).toBeGreaterThanOrEqual(1);
    expect(await plans.get(gone.id)).toBeNull();
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from maintenance_etapes where plan_id = ${gone.id}`;
    expect(row?.n).toBe(0);
    expect(await stateOf(kept.id)).toBe("confirmee");
  });
});
