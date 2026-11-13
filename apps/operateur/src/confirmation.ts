/**
 * Before acting, the operator verifies that I confirmed (ADR-0036): the bot
 * signed my confirmation with a key it alone holds; the operator holds the
 * public key, and only verifies. An action written "confirmed" by any other
 * program, moved to another machine, or a plan given one more step, is
 * refused by name — never run.
 *
 * Without the public key nothing is verified, so nothing runs: said by name.
 */
import type { KeyObject } from "node:crypto";
import {
  ConfirmationKeyError,
  confirmPublicKeyFromEnv,
  verifyActionConfirmation,
  verifyPlanConfirmation,
} from "@cenacle/core";
import {
  actionConfirmationOf,
  type PlanStore,
  planConfirmationOf,
  type StoredPlan,
  type StoredServerAction,
} from "@cenacle/journal";

/** The bot's public key, or null when it is missing or is not one. */
export function confirmKeyOrNull(env: NodeJS.ProcessEnv = process.env): KeyObject | null {
  try {
    return confirmPublicKeyFromEnv(env);
  } catch (error) {
    if (!(error instanceof ConfirmationKeyError)) throw error;
    return null;
  }
}

/** A plan I confirmed, with the very steps I confirmed. */
export function planSigned(publicKey: KeyObject | null, plan: StoredPlan): boolean {
  if (publicKey === null) return false;
  const fields = planConfirmationOf(plan);
  return fields !== null && verifyPlanConfirmation(publicKey, fields, plan.confirmSig);
}

export interface ConfirmedDeps {
  readonly publicKey: KeyObject | null;
  readonly plans: Pick<PlanStore, "get">;
}

/**
 * Why this action is not one I confirmed — the refusal's name — or null when
 * it is. My button's action carries its own signature. A plan's step carries
 * none: its plan's signature covers it, and it must be the step that plan
 * has in hand — launched, on that machine, for that action.
 */
export async function notConfirmed(
  deps: ConfirmedDeps,
  a: StoredServerAction,
): Promise<string | null> {
  if (deps.publicKey === null) return "cle_de_confirmation_absente";
  if (a.planId === null) {
    const fields = actionConfirmationOf(a);
    return fields !== null && verifyActionConfirmation(deps.publicKey, fields, a.confirmSig)
      ? null
      : "confirmation_non_signee";
  }
  // Never both a finding and a plan (the database refuses it): read here, it is refused too.
  if (a.findingId !== null) return "confirmation_non_signee";
  const plan = await deps.plans.get(a.planId);
  if (plan === null || !planSigned(deps.publicKey, plan)) return "confirmation_non_signee";
  const step = plan.steps.find((s) => s.actionId === a.id);
  const inHand =
    plan.state === "en_cours" &&
    step !== undefined &&
    step.state === "lancee" &&
    step.host === a.host &&
    step.action === a.action;
  return inHand ? null : "etape_hors_plan";
}
