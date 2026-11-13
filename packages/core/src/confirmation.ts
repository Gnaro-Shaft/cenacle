/**
 * My confirmation of an action on a server, signed by the bot (ADR-0036).
 *
 * The bot alone holds the private key; the operator holds the public key and
 * only verifies; no other program holds either. The signature covers what I
 * confirmed — for an action: its number, the machine, the action, the finding
 * and the instant; for a plan: its number, the fingerprint of its steps and
 * the instant. An action written "confirmed" without the bot, moved to
 * another machine, or a plan given one more step, is never run.
 * Ed25519, from node:crypto: no dependency. A pair of its own, never the
 * page's (ADR-0013).
 */
import { createHash, type KeyObject } from "node:crypto";
import {
  ed25519Key,
  generateKeys,
  privateKeyFromDer,
  publicKeyFromDer,
  signMessage,
  verifyMessage,
} from "./ed25519.ts";

export const CONFIRM_PRIVATE_KEY_VAR = "CENACLE_CONFIRM_PRIVATE_KEY";
export const CONFIRM_PUBLIC_KEY_VAR = "CENACLE_CONFIRM_PUBLIC_KEY";
const ACTION_VERSION = "cenacle-confirm-v1";
const PLAN_VERSION = "cenacle-plan-v1";
/** A machine or an action, as the database holds them: nothing that could end a line or a field. */
const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export class ConfirmationKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfirmationKeyError";
  }
}

/** A field that cannot be signed: the confirmation is refused rather than signed loosely. */
export class ConfirmationFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfirmationFieldError";
  }
}

/** What the signature of one action covers. */
export interface ActionConfirmation {
  readonly id: number;
  readonly host: string;
  readonly action: string;
  /** The finding my button was under. */
  readonly findingId: number;
  readonly confirmedAt: Date;
}

/** What makes a step of a plan, once confirmed: never its state, which moves. */
export interface PlanStepFields {
  readonly position: number;
  readonly host: string;
  readonly action: string;
  readonly conditional: boolean;
}

/** What the signature of a plan covers: the steps I did not remove, in order. */
export interface PlanConfirmation {
  readonly id: number;
  readonly steps: readonly PlanStepFields[];
  readonly confirmedAt: Date;
}

function number(value: number, what: string): string {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ConfirmationFieldError(`${what} is not a row number`);
  }
  return String(value);
}

function name(value: string, what: string): string {
  if (typeof value !== "string" || !NAME.test(value)) {
    throw new ConfirmationFieldError(`${what} is not a plain name`);
  }
  return value;
}

function instant(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ConfirmationFieldError("the instant of the confirmation is not a date");
  }
  return value.toISOString();
}

/** SHA-256, hex, of the steps in their order: one line each, nothing left to interpretation. */
export function planStepsHash(steps: readonly PlanStepFields[]): string {
  if (steps.length === 0) throw new ConfirmationFieldError("a plan with no step is not confirmed");
  const seen = new Set<number>();
  const lines = [...steps]
    .sort((a, b) => a.position - b.position)
    .map((s) => {
      if (!Number.isSafeInteger(s.position) || s.position < 0 || seen.has(s.position)) {
        throw new ConfirmationFieldError("a step's position is not a rank of its own");
      }
      seen.add(s.position);
      if (typeof s.conditional !== "boolean") {
        throw new ConfirmationFieldError("a step is conditional or it is not");
      }
      return [
        String(s.position),
        name(s.host, "a step's machine"),
        name(s.action, "a step's action"),
        s.conditional ? "1" : "0",
      ].join(":");
    });
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

export function actionConfirmationMessage(f: ActionConfirmation): string {
  return [
    ACTION_VERSION,
    number(f.id, "the action"),
    name(f.host, "the machine"),
    name(f.action, "the action's name"),
    number(f.findingId, "the finding"),
    instant(f.confirmedAt),
  ].join("\n");
}

export function planConfirmationMessage(f: PlanConfirmation): string {
  return [
    PLAN_VERSION,
    number(f.id, "the plan"),
    planStepsHash(f.steps),
    instant(f.confirmedAt),
  ].join("\n");
}

/** Throws a ConfirmationFieldError rather than sign a field it cannot pin down. */
export function signActionConfirmation(privateKey: KeyObject, f: ActionConfirmation): string {
  return signMessage(privateKey, actionConfirmationMessage(f));
}

export function signPlanConfirmation(privateKey: KeyObject, f: PlanConfirmation): string {
  return signMessage(privateKey, planConfirmationMessage(f));
}

/** Never throws: anything but a valid signature of these exact fields is false. */
export function verifyActionConfirmation(
  publicKey: KeyObject,
  f: ActionConfirmation,
  signature: string | null,
): boolean {
  try {
    return verifyMessage(publicKey, actionConfirmationMessage(f), signature);
  } catch {
    return false;
  }
}

/** Never throws: anything but a valid signature of this plan and these exact steps is false. */
export function verifyPlanConfirmation(
  publicKey: KeyObject,
  f: PlanConfirmation,
  signature: string | null,
): boolean {
  try {
    return verifyMessage(publicKey, planConfirmationMessage(f), signature);
  } catch {
    return false;
  }
}

/** A new key pair, as the base64 DER strings the environment holds. */
export const generateConfirmationKeys = generateKeys;

function read(env: NodeJS.ProcessEnv, variable: string): Buffer {
  const value = env[variable] ?? "";
  if (value === "") {
    throw new ConfirmationKeyError(
      `${variable} is missing — generate the keys with: npm run keys:confirm`,
    );
  }
  return Buffer.from(value, "base64");
}

const keyError = (message: string) => new ConfirmationKeyError(message);

/** The bot only. */
export function confirmPrivateKeyFromEnv(env: NodeJS.ProcessEnv = process.env): KeyObject {
  const der = read(env, CONFIRM_PRIVATE_KEY_VAR);
  return ed25519Key(CONFIRM_PRIVATE_KEY_VAR, () => privateKeyFromDer(der), keyError);
}

/** The operator. */
export function confirmPublicKeyFromEnv(env: NodeJS.ProcessEnv = process.env): KeyObject {
  const der = read(env, CONFIRM_PUBLIC_KEY_VAR);
  return ed25519Key(CONFIRM_PUBLIC_KEY_VAR, () => publicKeyFromDer(der), keyError);
}
