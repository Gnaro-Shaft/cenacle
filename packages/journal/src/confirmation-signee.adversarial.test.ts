// My confirmation, signed (ADR-0036), in the real database: the signature is
// made on the row locked for the confirmation, as it reads once confirmed,
// and written with it — both or neither; a signer that fails confirms
// nothing; a move in flight is waited for, then counted.
import { verifyActionConfirmation, verifyPlanConfirmation } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import type { StoredPlan } from "./maintenance-plans.ts";
import type { StoredServerAction } from "./serveur-actions.ts";
import { confirmationKit } from "./test-confirmation.ts";

const {
  actions,
  plans,
  pub,
  T0,
  S,
  made,
  request,
  fieldsOf,
  signAction,
  STEPS,
  signedSteps,
  planFields,
  signPlan,
  asked,
  holding,
  aMoment,
} = confirmationKit();

describe("an action's signature is written with my confirmation", () => {
  it("made on the row as it reads once confirmed; read back, it verifies", async () => {
    const r = await request();
    const at = new Date(T0.getTime() + 30 * S);
    let shown: StoredServerAction | null = null;
    const outcome = await actions.confirm(r.id, r.token, at, (a) => {
      shown = a;
      return signAction(a);
    });
    expect(outcome).toBe("done");
    expect(shown).toMatchObject({ id: r.id, state: "confirmee", confirmedAt: at });
    const stored = await actions.get(r.id);
    if (stored === null) throw new Error("the action vanished");
    expect(stored.confirmSig).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(verifyActionConfirmation(pub, fieldsOf(stored), stored.confirmSig)).toBe(true);
    // The signature binds the machine: read on another, it is nothing.
    expect(
      verifyActionConfirmation(pub, { ...fieldsOf(stored), host: "noeud-a" }, stored.confirmSig),
    ).toBe(false);
  });

  it("a signer that fails confirms nothing — and the token still works after", async () => {
    const r = await request();
    await expect(
      actions.confirm(r.id, r.token, T0, () => {
        throw new Error("no key");
      }),
    ).rejects.toThrow(/no key/);
    expect(await actions.get(r.id)).toMatchObject({ state: "demandee", confirmSig: null });
    expect(await actions.confirm(r.id, r.token, T0, signAction)).toBe("done");
  });

  it("a signature that is not one is refused by the database: nothing confirmed", async () => {
    const r = await request();
    await expect(actions.confirm(r.id, r.token, T0, () => "signed, trust me")).rejects.toThrow(
      /confirm_sig_form/,
    );
    expect(await actions.get(r.id)).toMatchObject({ state: "demandee", confirmSig: null });
  });

  it("a wrong token, a late tap: the signer is never even asked", async () => {
    const r = await request();
    let calls = 0;
    const counting = (a: StoredServerAction) => {
      calls += 1;
      return signAction(a);
    };
    expect(await actions.confirm(r.id, "f".repeat(16), T0, counting)).toBe("stale");
    expect(await actions.confirm(r.id, r.token, new Date(T0.getTime() + 121 * S), counting)).toBe(
      "expired",
    );
    expect(calls).toBe(0);
  });

  it("two taps at once: one signature, one 'already'", async () => {
    const r = await request();
    let calls = 0;
    const counting = (a: StoredServerAction) => {
      calls += 1;
      return signAction(a);
    };
    const outcomes = await Promise.all([
      actions.confirm(r.id, r.token, T0, counting),
      actions.confirm(r.id, r.token, T0, counting),
    ]);
    expect([...outcomes].sort()).toEqual(["already", "done"]);
    expect(calls).toBe(1);
  });

  it("the row is held before it is signed: while another move holds it, the signer is not asked", async () => {
    const r = await request();
    let calls = 0;
    const hold = await holding(
      (tx) => tx`select id from serveur_actions where id = ${r.id} for update`,
    );
    const confirming = actions.confirm(r.id, r.token, T0, (a) => {
      calls += 1;
      return signAction(a);
    });
    await aMoment();
    const asked = calls;
    // Released whatever was seen: a held row would hang every test after this one.
    await hold.release();
    expect(await confirming).toBe("done");
    // Signing first and locking after would sign a row another move may still change.
    expect(asked).toBe(0);
    expect(calls).toBe(1);
  });

  it("without a signer, as before the bot signs: confirmed, and visibly unsigned", async () => {
    const r = await request();
    expect(await actions.confirm(r.id, r.token, T0)).toBe("done");
    expect(await actions.get(r.id)).toMatchObject({ state: "confirmee", confirmSig: null });
  });
});

describe("a plan's signature covers its steps", () => {
  it("made on the plan and the steps I kept; read back, it verifies", async () => {
    const p = await asked();
    expect(await plans.remove(p.id, p.token, "noeud-a", null)).toBe(true);
    const at = new Date(T0.getTime() + 60 * S);
    let shown: StoredPlan | null = null;
    expect(
      await plans.confirm(p.id, p.confirm, at, (plan) => {
        shown = plan;
        return signPlan(plan);
      }),
    ).toBe("done");
    expect(shown).toMatchObject({ id: p.id, state: "confirmee", confirmedAt: at });
    const stored = await plans.get(p.id);
    if (stored === null) throw new Error("the plan vanished");
    expect(signedSteps(stored).map((s) => s.host)).toEqual(["vps-b", "vps-b"]);
    expect(verifyPlanConfirmation(pub, planFields(stored), stored.confirmSig)).toBe(true);
    // The removed step, counted back in, breaks it.
    const all = stored.steps.map((s) => ({
      position: s.position,
      host: s.host,
      action: s.action,
      conditional: s.conditional,
    }));
    expect(
      verifyPlanConfirmation(pub, { ...planFields(stored), steps: all }, stored.confirmSig),
    ).toBe(false);
  });

  it("a signer that fails confirms nothing — and the token still works after", async () => {
    const p = await asked();
    await expect(
      plans.confirm(p.id, p.confirm, T0, () => {
        throw new Error("no key");
      }),
    ).rejects.toThrow(/no key/);
    expect(await plans.get(p.id)).toMatchObject({ state: "a_confirmer", confirmSig: null });
    expect(await plans.confirm(p.id, p.confirm, T0, signPlan)).toBe("done");
  });

  it("the steps are held before the plan is signed: a 'Retirer' in flight is waited for, then counted", async () => {
    const p = await asked();
    let shown: StoredPlan | null = null;
    // A removal in flight: the step is changed, not yet committed.
    const hold = await holding(
      (tx) => tx`update maintenance_etapes set state = 'retiree'
                 where plan_id = ${p.id} and host = 'noeud-a'`,
    );
    const confirming = plans.confirm(p.id, p.confirm, T0, (plan) => {
      shown = plan;
      return signPlan(plan);
    });
    await aMoment();
    const early = shown;
    await hold.release();
    expect(await confirming).toBe("done");
    expect(early).toBeNull();
    // Signed on what the removal left, not on what was there before it.
    const stored = await plans.get(p.id);
    if (stored === null) throw new Error("the plan vanished");
    expect(signedSteps(stored).map((x) => x.host)).toEqual(["vps-b", "vps-b"]);
    expect(verifyPlanConfirmation(pub, planFields(stored), stored.confirmSig)).toBe(true);
  });

  it("beside a running plan: 'busy', and no signature left behind", async () => {
    const running = await asked();
    expect(await plans.confirm(running.id, running.confirm, T0, signPlan)).toBe("done");
    const second = await plans.propose(STEPS, T0);
    const token = await plans.ask(second.id, second.token, T0);
    expect(await plans.confirm(second.id, token ?? "", T0, signPlan)).toBe("busy");
    expect(await plans.get(second.id)).toMatchObject({ state: "a_confirmer", confirmSig: null });
  });

  it("a signed plan still runs: start, launch, settle, end", async () => {
    const p = await asked();
    expect(await plans.confirm(p.id, p.confirm, T0, signPlan)).toBe("done");
    expect(await plans.start(p.id)).toBe(true);
    const first = (await plans.get(p.id))?.steps[0];
    if (first === undefined) throw new Error("steps");
    const actionId = await plans.launchStep(first.id, T0);
    if (actionId === null) throw new Error("the step did not launch");
    made.push(actionId);
    expect(await plans.settle(first.id, "faite", null)).toBe(true);
    expect(await plans.finish(p.id, "terminee", null, T0)).toBe(true);
    const ended = await plans.get(p.id);
    expect(ended?.steps.map((s) => s.state)).toEqual(["faite", "annulee", "annulee"]);
    // Its states moved; what I signed did not.
    if (ended === null) throw new Error("the plan vanished");
    expect(verifyPlanConfirmation(pub, planFields(ended), ended.confirmSig)).toBe(true);
  });
});
