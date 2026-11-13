// What is signed is what is read back (ADR-0036): the one definition the bot
// signs with and the operator verifies with survives the real database — the
// instant to the millisecond, the steps I kept and not the one I removed —
// and gives nothing to sign for what carries no confirmation of its own.
import {
  signActionConfirmation,
  signPlanConfirmation,
  verifyActionConfirmation,
  verifyPlanConfirmation,
} from "@cenacle/core";
import { describe, expect, it } from "vitest";
import { actionConfirmationOf, planConfirmationOf } from "./confirmation-fields.ts";
import type { StoredPlan } from "./maintenance-plans.ts";
import type { StoredServerAction } from "./serveur-actions.ts";
import { confirmationKit } from "./test-confirmation.ts";

const { actions, plans, priv, pub, T0, made, request, asked } = confirmationKit();
// An instant with milliseconds: the database keeps them, or nothing would ever verify.
const AT = new Date(T0.getTime() + 12_345);

const signAction = (a: StoredServerAction) => {
  const fields = actionConfirmationOf(a);
  if (fields === null) throw new Error("not an action of my button");
  return signActionConfirmation(priv, fields);
};
const signPlan = (p: StoredPlan) => {
  const fields = planConfirmationOf(p);
  if (fields === null) throw new Error("not a confirmed plan");
  return signPlanConfirmation(priv, fields);
};

describe("an action of my button", () => {
  it("signed as confirmed, stored, read back: the same fields, and it verifies", async () => {
    const r = await request();
    expect(await actions.confirm(r.id, r.token, AT, signAction)).toBe("done");
    const stored = await actions.get(r.id);
    const fields = stored === null ? null : actionConfirmationOf(stored);
    if (stored === null || fields === null) throw new Error("the action vanished");
    expect(fields.confirmedAt.getTime()).toBe(AT.getTime());
    expect(verifyActionConfirmation(pub, fields, stored.confirmSig)).toBe(true);
  });

  it("not yet confirmed: nothing to sign", async () => {
    const r = await request();
    const pending = await actions.get(r.id);
    expect(pending === null ? "gone" : actionConfirmationOf(pending)).toBeNull();
  });
});

describe("a plan", () => {
  it("signed with the steps I kept, stored, read back: it verifies — and its step's action has no fields of its own", async () => {
    const p = await asked();
    expect(await plans.remove(p.id, p.token, "noeud-a", null)).toBe(true);
    expect(await plans.confirm(p.id, p.confirm, AT, signPlan)).toBe("done");
    const plan = await plans.get(p.id);
    const fields = plan === null ? null : planConfirmationOf(plan);
    if (plan === null || fields === null) throw new Error("the plan vanished");
    expect(fields.confirmedAt.getTime()).toBe(AT.getTime());
    expect(fields.steps.map((s) => s.host)).toEqual(["vps-b", "vps-b"]);
    expect(verifyPlanConfirmation(pub, fields, plan.confirmSig)).toBe(true);

    await plans.start(p.id);
    const first = plan.steps[0];
    if (first === undefined) throw new Error("steps");
    const id = await plans.launchStep(first.id, AT);
    if (id === null) throw new Error("the step did not launch");
    made.push(id);
    const stepAction = await actions.get(id);
    expect(stepAction === null ? "gone" : actionConfirmationOf(stepAction)).toBeNull();
    // Launched, the step moved; what I signed did not.
    const after = await plans.get(p.id);
    const again = after === null ? null : planConfirmationOf(after);
    if (after === null || again === null) throw new Error("the plan vanished");
    expect(verifyPlanConfirmation(pub, again, after.confirmSig)).toBe(true);
  });

  it("not yet confirmed: nothing to sign", async () => {
    const p = await asked();
    const pending = await plans.get(p.id);
    expect(pending === null ? "gone" : planConfirmationOf(pending)).toBeNull();
  });
});
