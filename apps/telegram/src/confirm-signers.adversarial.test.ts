// The bot's signers (ADR-0036): with its key, it signs my button's action
// and a confirmed plan — what the operator's key then verifies; a plan's
// step, an unconfirmed row or plan, is never signed; without its key, or with
// a key that is not one, there is no signer at all, and the reason says what
// to run — never a value.
import {
  CONFIRM_PRIVATE_KEY_VAR,
  CONFIRM_PUBLIC_KEY_VAR,
  ConfirmationFieldError,
  confirmPublicKeyFromEnv,
  generateConfirmationKeys,
  verifyActionConfirmation,
  verifyPlanConfirmation,
} from "@cenacle/core";
import {
  actionConfirmationOf,
  planConfirmationOf,
  type StoredPlan,
  type StoredServerAction,
} from "@cenacle/journal";
import { describe, expect, it } from "vitest";
import { confirmSigners } from "./confirm-signers.ts";

const keys = generateConfirmationKeys();
const pub = confirmPublicKeyFromEnv({ [CONFIRM_PUBLIC_KEY_VAR]: keys.publicKey });
const signers = confirmSigners({ [CONFIRM_PRIVATE_KEY_VAR]: keys.privateKey });
const AT = new Date("2026-11-13T10:00:00.250Z");

const action: StoredServerAction = {
  id: 7,
  findingId: 41,
  planId: null,
  host: "vps-b",
  action: "redemarrer",
  state: "confirmee",
  requestedAt: AT,
  confirmedAt: AT,
  finishedAt: null,
  exitCode: null,
  refusal: null,
  verified: null,
  beforeCount: null,
  afterCount: null,
  confirmSig: null,
};
const plan: StoredPlan = {
  id: 10,
  state: "confirmee",
  createdAt: AT,
  confirmedAt: AT,
  messageId: null,
  confirmSig: null,
  steps: [
    {
      id: 1,
      position: 0,
      host: "vps-b",
      action: "maj_securite",
      conditional: false,
      state: "attente",
      actionId: null,
      reason: null,
    },
    {
      id: 2,
      position: 1,
      host: "noeud-a",
      action: "redemarrer",
      conditional: true,
      state: "retiree",
      actionId: null,
      reason: null,
    },
  ],
};

describe("with its key", () => {
  it("signs my button's action: what the operator's key verifies, for that row alone", () => {
    const sig = signers.signAction?.(action) ?? null;
    const fields = actionConfirmationOf(action);
    if (fields === null) throw new Error("fields");
    expect(signers.problem).toBeNull();
    expect(verifyActionConfirmation(pub, fields, sig)).toBe(true);
    expect(verifyActionConfirmation(pub, { ...fields, host: "noeud-a" }, sig)).toBe(false);
  });

  it("signs a plan with the steps I kept — the removed one is not in it", () => {
    const sig = signers.signPlan?.(plan) ?? null;
    const fields = planConfirmationOf(plan);
    if (fields === null) throw new Error("fields");
    expect(fields.steps.map((s) => s.host)).toEqual(["vps-b"]);
    expect(verifyPlanConfirmation(pub, fields, sig)).toBe(true);
    const withRemoved = planConfirmationOf({
      ...plan,
      steps: plan.steps.map((s) => ({ ...s, state: "attente" as const })),
    });
    if (withRemoved === null) throw new Error("fields");
    expect(verifyPlanConfirmation(pub, withRemoved, sig)).toBe(false);
  });

  it.each([
    ["a plan's step (it is signed with its plan)", { ...action, findingId: null, planId: 10 }],
    ["a row with both a finding and a plan", { ...action, planId: 10 }],
    ["a row with no instant of confirmation", { ...action, confirmedAt: null }],
    ["a machine that carries a line break", { ...action, host: "vps-b\nnoeud-a" }],
  ] as Array<[string, StoredServerAction]>)("%s: never signed", (_label, row) => {
    expect(() => signers.signAction?.(row)).toThrow(ConfirmationFieldError);
  });

  it.each([
    ["a plan not confirmed", { ...plan, confirmedAt: null }],
    [
      "a plan with every step removed",
      { ...plan, steps: plan.steps.map((s) => ({ ...s, state: "retiree" as const })) },
    ],
  ] as Array<[string, StoredPlan]>)("%s: never signed", (_label, p) => {
    expect(() => signers.signPlan?.(p)).toThrow(ConfirmationFieldError);
  });
});

describe("without its key", () => {
  it.each([
    ["no key at all", {}],
    ["an empty key", { [CONFIRM_PRIVATE_KEY_VAR]: "" }],
    ["garbage", { [CONFIRM_PRIVATE_KEY_VAR]: "not-a-key" }],
    ["the public key in its place", { [CONFIRM_PRIVATE_KEY_VAR]: keys.publicKey }],
  ])("%s: no signer, and the reason names the variable — never a value", (_label, env) => {
    const none = confirmSigners(env);
    expect(none.signAction).toBeNull();
    expect(none.signPlan).toBeNull();
    expect(none.problem).toMatch(/CENACLE_CONFIRM_PRIVATE_KEY/);
    expect(none.problem).not.toContain(keys.publicKey);
    expect(none.problem).not.toContain("not-a-key");
  });
});
