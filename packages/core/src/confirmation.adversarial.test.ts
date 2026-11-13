// Only the holder of the bot's private key can produce a confirmation, and
// only for one action on one machine at one instant — or one plan with these
// exact steps (ADR-0036). A signature copied elsewhere, a step added, a field
// that could hide another: never valid. The page's key is not the bot's.
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateAcceptanceKeys, PRIVATE_KEY_VAR, privateKeyFromEnv } from "./acceptance.ts";
import {
  type ActionConfirmation,
  actionConfirmationMessage,
  CONFIRM_PRIVATE_KEY_VAR,
  CONFIRM_PUBLIC_KEY_VAR,
  ConfirmationFieldError,
  ConfirmationKeyError,
  confirmPrivateKeyFromEnv,
  confirmPublicKeyFromEnv,
  generateConfirmationKeys,
  type PlanConfirmation,
  type PlanStepFields,
  planConfirmationMessage,
  planStepsHash,
  signActionConfirmation,
  signPlanConfirmation,
  verifyActionConfirmation,
  verifyPlanConfirmation,
} from "./confirmation.ts";

const keys = generateConfirmationKeys();
const env = {
  [CONFIRM_PRIVATE_KEY_VAR]: keys.privateKey,
  [CONFIRM_PUBLIC_KEY_VAR]: keys.publicKey,
};
const priv = confirmPrivateKeyFromEnv(env);
const pub = confirmPublicKeyFromEnv(env);
const AT = new Date("2026-11-13T09:54:42.656Z");

const action: ActionConfirmation = {
  id: 59,
  host: "vps-b",
  action: "redemarrer",
  findingId: 412,
  confirmedAt: AT,
};
const actionSig = signActionConfirmation(priv, action);

const STEPS: PlanStepFields[] = [
  { position: 0, host: "vps-b", action: "maj_securite", conditional: false },
  { position: 1, host: "vps-b", action: "services", conditional: true },
  { position: 3, host: "noeud-a", action: "redemarrer", conditional: true },
];
const plan: PlanConfirmation = { id: 10, steps: STEPS, confirmedAt: AT };
const planSig = signPlanConfirmation(priv, plan);

describe("an action's confirmation", () => {
  it("verifies the exact fields it was made for", () => {
    expect(verifyActionConfirmation(pub, action, actionSig)).toBe(true);
    expect(actionSig).toMatch(/^[A-Za-z0-9_-]{86}$/);
  });

  it.each([
    ["another action row", { id: 60 }],
    ["another machine", { host: "noeud-a" }],
    ["another action of the catalogue", { action: "services" }],
    ["another finding", { findingId: 413 }],
    ["another instant, one millisecond later", { confirmedAt: new Date(AT.getTime() + 1) }],
  ] as Array<[string, Partial<ActionConfirmation>]>)("%s: refused", (_label, change) => {
    expect(verifyActionConfirmation(pub, { ...action, ...change }, actionSig)).toBe(false);
  });

  it.each([
    ["no signature", null],
    ["an empty one", ""],
    ["one character short", actionSig.slice(1)],
    ["one character flipped", `${actionSig[0] === "A" ? "B" : "A"}${actionSig.slice(1)}`],
    ["not base64url", "!".repeat(86)],
    ["a plan's signature", planSig],
    ["SQL", "' or 1=1 --"],
  ])("%s: refused, without throwing", (_label, signature) => {
    expect(verifyActionConfirmation(pub, action, signature)).toBe(false);
  });

  it("another key pair's signature, or the page's own key: refused", () => {
    const other = confirmPrivateKeyFromEnv({
      [CONFIRM_PRIVATE_KEY_VAR]: generateConfirmationKeys().privateKey,
    });
    expect(verifyActionConfirmation(pub, action, signActionConfirmation(other, action))).toBe(
      false,
    );
    const page = privateKeyFromEnv({ [PRIVATE_KEY_VAR]: generateAcceptanceKeys().privateKey });
    expect(verifyActionConfirmation(pub, action, signActionConfirmation(page, action))).toBe(false);
  });

  it.each([
    ["a machine that carries a line break", { host: "vps-b\nnoeud-a" }],
    ["a machine that carries another field", { host: "vps-b:redemarrer" }],
    ["an empty machine", { host: "" }],
    ["an action in capitals", { action: "REDEMARRER" }],
    ["row zero", { id: 0 }],
    ["a row that is not a whole number", { id: 59.5 }],
    ["a finding that is not a number", { findingId: Number.NaN }],
    ["an instant that is no instant", { confirmedAt: new Date(Number.NaN) }],
  ] as Array<[string, Partial<ActionConfirmation>]>)(
    "%s: never signed, and never verified",
    (_label, change) => {
      const fields = { ...action, ...change };
      expect(() => signActionConfirmation(priv, fields)).toThrow(ConfirmationFieldError);
      expect(() => actionConfirmationMessage(fields)).toThrow(ConfirmationFieldError);
      expect(verifyActionConfirmation(pub, fields, actionSig)).toBe(false);
    },
  );
});

describe("a plan's confirmation", () => {
  it("verifies this plan and these exact steps, in whatever order they are given", () => {
    expect(verifyPlanConfirmation(pub, plan, planSig)).toBe(true);
    expect(verifyPlanConfirmation(pub, { ...plan, steps: [...STEPS].reverse() }, planSig)).toBe(
      true,
    );
  });

  it.each([
    ["another plan", { id: 11 }],
    ["another instant", { confirmedAt: new Date(AT.getTime() + 1000) }],
    [
      "a step added at the end",
      {
        steps: [...STEPS, { position: 4, host: "noeud-a", action: "services", conditional: false }],
      },
    ],
    [
      "a step slipped into the gap a removed step left",
      {
        steps: [...STEPS, { position: 2, host: "vps-b", action: "redemarrer", conditional: false }],
      },
    ],
    ["a step taken away", { steps: STEPS.slice(0, 2) }],
    [
      "a step moved to another machine",
      { steps: STEPS.map((s) => (s.position === 3 ? { ...s, host: "vps-b" } : s)) },
    ],
    [
      "a step given another action",
      { steps: STEPS.map((s) => (s.position === 1 ? { ...s, action: "redemarrer" } : s)) },
    ],
    [
      "an 'if needed' made unconditional",
      { steps: STEPS.map((s) => (s.position === 3 ? { ...s, conditional: false } : s)) },
    ],
    [
      "two steps swapped",
      {
        steps: STEPS.map((s) =>
          s.position === 0 ? { ...s, position: 1 } : s.position === 1 ? { ...s, position: 0 } : s,
        ),
      },
    ],
  ] as Array<[string, Partial<PlanConfirmation>]>)("%s: refused", (_label, change) => {
    expect(verifyPlanConfirmation(pub, { ...plan, ...change }, planSig)).toBe(false);
  });

  it("an action's signature is not a plan's, even with the same number and instant", () => {
    const sig = signActionConfirmation(priv, { ...action, id: plan.id });
    expect(verifyPlanConfirmation(pub, plan, sig)).toBe(false);
  });

  it.each([
    ["no step at all", []],
    ["two steps of the same rank", [STEPS[0], { ...STEPS[1], position: 0 }]],
    ["a negative rank", [{ ...STEPS[0], position: -1 }]],
    ["a machine that carries a separator", [{ ...STEPS[0], host: "vps-b:services" }]],
    ["an action with a line break", [{ ...STEPS[0], action: "services\n1" }]],
  ] as Array<[string, PlanStepFields[]]>)("%s: never signed, never verified", (_label, steps) => {
    expect(() => planStepsHash(steps)).toThrow(ConfirmationFieldError);
    expect(() => signPlanConfirmation(priv, { ...plan, steps })).toThrow(ConfirmationFieldError);
    expect(() => planConfirmationMessage({ ...plan, steps })).toThrow(ConfirmationFieldError);
    expect(verifyPlanConfirmation(pub, { ...plan, steps }, planSig)).toBe(false);
  });

  it("two different step lists never share a fingerprint by gluing fields together", () => {
    const a = planStepsHash([{ position: 1, host: "a-b", action: "c", conditional: false }]);
    const b = planStepsHash([{ position: 1, host: "a", action: "b-c", conditional: false }]);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the keys", () => {
  it("a missing key says how to make one", () => {
    expect(() => confirmPrivateKeyFromEnv({})).toThrow(/npm run keys:confirm/);
    expect(() => confirmPublicKeyFromEnv({ [CONFIRM_PUBLIC_KEY_VAR]: "" })).toThrow(
      ConfirmationKeyError,
    );
  });

  it("garbage, a public key given as private, or another algorithm: refused", () => {
    expect(() => confirmPrivateKeyFromEnv({ [CONFIRM_PRIVATE_KEY_VAR]: "not-a-key" })).toThrow(
      /not a valid key/,
    );
    expect(() => confirmPrivateKeyFromEnv({ [CONFIRM_PRIVATE_KEY_VAR]: keys.publicKey })).toThrow(
      ConfirmationKeyError,
    );
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const der = rsa.publicKey.export({ type: "spki", format: "der" }).toString("base64");
    expect(() => confirmPublicKeyFromEnv({ [CONFIRM_PUBLIC_KEY_VAR]: der })).toThrow(
      /not an Ed25519 key/,
    );
  });

  it("an error never carries the key", () => {
    const error = (() => {
      try {
        confirmPrivateKeyFromEnv({ [CONFIRM_PRIVATE_KEY_VAR]: `${keys.privateKey}x` });
      } catch (e) {
        return e as Error;
      }
      return null;
    })();
    // A key with one more character may still decode: what matters is that no message quotes it.
    expect(error?.message ?? "").not.toContain(keys.privateKey.slice(0, 16));
  });
});
