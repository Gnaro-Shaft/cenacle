/**
 * What a signed confirmation covers, read from the rows (ADR-0036). Said
 * once, here, for the bot that signs and the operator that verifies: two
 * readings of the same row that differed would refuse every action — or,
 * worse, agree on less than what I confirmed.
 */
import type { ActionConfirmation, PlanConfirmation } from "@cenacle/core";
import type { StoredPlan } from "./maintenance-plans.ts";
import type { StoredServerAction } from "./serveur-actions.ts";

/**
 * An action of my button, as confirmed. Null for a row that carries no
 * confirmation of its own: a plan's step (signed with its plan), or a row
 * with no instant of confirmation.
 */
export function actionConfirmationOf(a: StoredServerAction): ActionConfirmation | null {
  if (a.findingId === null || a.planId !== null || a.confirmedAt === null) return null;
  return {
    id: a.id,
    host: a.host,
    action: a.action,
    findingId: a.findingId,
    confirmedAt: a.confirmedAt,
  };
}

/**
 * A plan, as confirmed: the steps I kept, whatever became of them since —
 * their states move, what they are does not. Null for a plan with no instant
 * of confirmation.
 */
export function planConfirmationOf(p: StoredPlan): PlanConfirmation | null {
  if (p.confirmedAt === null) return null;
  return {
    id: p.id,
    confirmedAt: p.confirmedAt,
    steps: p.steps
      .filter((s) => s.state !== "retiree")
      .map((s) => ({
        position: s.position,
        host: s.host,
        action: s.action,
        conditional: s.conditional,
      })),
  };
}
