// The database freezes what I was shown (ADR-0036, migration 033): a step
// is added only while its plan is proposed, never changes its plan, rank,
// machine, action or condition, never comes back once removed, and nothing
// is removed once I confirmed — whoever asks, however it is asked.
import { verifyPlanConfirmation } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import { confirmationKit } from "./test-confirmation.ts";

const { sql, plans, pub, T0, freeTheWay, STEPS, planFields, signPlan, asked } = confirmationKit();

describe("the steps are frozen by the database", () => {
  const addStep = (planId: number, position: number, state = "attente") =>
    sql`insert into maintenance_etapes (plan_id, position, host, action, conditional, state)
        values (${planId}, ${position}, 'noeud-z', 'redemarrer', false, ${state})`;

  it("a step is added waiting, and only while its plan is proposed — never once I am asked", async () => {
    await freeTheWay();
    const p = await plans.propose(STEPS, T0);
    await expect(addStep(p.id, 50, "lancee")).rejects.toThrow(/added waiting/);
    const token = await plans.ask(p.id, p.token, T0);
    // Asked: the list I read is the list I sign.
    await expect(addStep(p.id, 51)).rejects.toThrow(/only while its plan is proposed/);
    expect(await plans.confirm(p.id, token ?? "", T0, signPlan)).toBe("done");
    await expect(addStep(p.id, 52)).rejects.toThrow(/only while its plan is proposed/);
    await plans.start(p.id);
    await expect(addStep(p.id, 53)).rejects.toThrow(/only while its plan is proposed/);
    await expect(addStep(2 ** 40, 0)).rejects.toThrow();
    expect((await plans.get(p.id))?.steps).toHaveLength(3);
  });

  it.each([
    ["its machine", "host = 'noeud-z'"],
    ["its action", "action = 'redemarrer'"],
    ["its rank", "position = 77"],
    ["its condition", "conditional = not conditional"],
  ])("a step never changes %s, proposed or confirmed", async (_label, change) => {
    const p = await asked();
    const [step] = (await plans.get(p.id))?.steps ?? [];
    if (step === undefined) throw new Error("steps");
    const tamper = () =>
      sql.unsafe(`update maintenance_etapes set ${change} where id = ${step.id}`);
    await expect(tamper()).rejects.toThrow(/never change/);
    expect(await plans.confirm(p.id, p.confirm, T0, signPlan)).toBe("done");
    await expect(tamper()).rejects.toThrow(/never change/);
    expect((await plans.get(p.id))?.steps[0]).toMatchObject({
      host: "vps-b",
      action: "maj_securite",
      position: 0,
      conditional: false,
    });
  });

  it("a step never moves to another plan", async () => {
    const a = await asked();
    const other = await plans.propose(STEPS, T0); // replaces `a`, still unconfirmed
    const [step] = (await plans.get(a.id))?.steps ?? [];
    if (step === undefined) throw new Error("steps");
    await expect(
      sql`update maintenance_etapes set plan_id = ${other.id}, position = 60 where id = ${step.id}`,
    ).rejects.toThrow(/never change/);
  });

  it("a removed step never comes back — not even before I confirm", async () => {
    const p = await asked();
    expect(await plans.remove(p.id, p.token, "noeud-a", null)).toBe(true);
    const back = () =>
      sql`update maintenance_etapes set state = 'attente'
          where plan_id = ${p.id} and state = 'retiree'`;
    await expect(back()).rejects.toThrow(/never comes back/);
    expect(await plans.confirm(p.id, p.confirm, T0, signPlan)).toBe("done");
    await expect(back()).rejects.toThrow(/never comes back/);
  });

  it("nothing is removed once I confirmed: not by the store, not by hand", async () => {
    const p = await asked();
    expect(await plans.confirm(p.id, p.confirm, T0, signPlan)).toBe("done");
    expect(await plans.remove(p.id, p.token, "noeud-a", null)).toBe(false);
    await expect(
      sql`update maintenance_etapes set state = 'retiree' where plan_id = ${p.id}`,
    ).rejects.toThrow(/once confirmed/);
    const stored = await plans.get(p.id);
    if (stored === null) throw new Error("the plan vanished");
    expect(stored.steps.map((s) => s.state)).toEqual(["attente", "attente", "attente"]);
    expect(verifyPlanConfirmation(pub, planFields(stored), stored.confirmSig)).toBe(true);
  });

  it("a temporary table named like the plans does not thaw them", async () => {
    const p = await asked();
    expect(await plans.confirm(p.id, p.confirm, T0, signPlan)).toBe("done");
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe("create temp table maintenance_plans (id bigint, state text)");
        await tx.unsafe(`insert into maintenance_plans values (${p.id}, 'proposee')`);
        await tx.unsafe(
          `insert into public.maintenance_etapes (plan_id, position, host, action, conditional, state)
           values (${p.id}, 54, 'noeud-z', 'redemarrer', false, 'attente')`,
        );
      }),
    ).rejects.toThrow(/only while its plan is proposed/);
    expect((await plans.get(p.id))?.steps).toHaveLength(3);
  });
});
