/**
 * My acceptance of a proposal, signed by the page (ADR-0013).
 *
 * The page's server alone holds the private key; the executor holds the
 * public key and only verifies; Iris holds neither. The signature covers the
 * proposal, its mail and the SHA-256 of the exact text I accepted, so a
 * proposal accepted without the page, or whose text changed afterwards, is
 * never sent. Ed25519, from node:crypto: no dependency (the mechanics are in
 * ed25519.ts, shared with the bot's confirmation, ADR-0036 — another pair of keys).
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

export const PRIVATE_KEY_VAR = "CENACLE_ACCEPT_PRIVATE_KEY";
export const PUBLIC_KEY_VAR = "CENACLE_ACCEPT_PUBLIC_KEY";
const VERSION = "cenacle-accept-v1";

export class AcceptanceKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcceptanceKeyError";
  }
}

/** What the signature covers. */
export interface AcceptanceFields {
  readonly id: string;
  readonly mailUidValidity: string;
  readonly mailUid: number;
  readonly draft: string;
  readonly decidedAt: Date;
}

/** SHA-256 of the text, hex — the same as PostgreSQL's sha256(convert_to(draft, 'UTF8')). */
export const draftHash = (draft: string): string =>
  createHash("sha256").update(draft, "utf8").digest("hex");

export function acceptanceMessage(f: AcceptanceFields): string {
  return [
    VERSION,
    f.id,
    f.mailUidValidity,
    String(f.mailUid),
    draftHash(f.draft),
    f.decidedAt.toISOString(),
  ].join("\n");
}

export function signAcceptance(privateKey: KeyObject, f: AcceptanceFields): string {
  return signMessage(privateKey, acceptanceMessage(f));
}

/** Never throws: anything but a valid signature of these exact fields is false. */
export function verifyAcceptance(
  publicKey: KeyObject,
  f: AcceptanceFields,
  signature: string | null,
): boolean {
  try {
    return verifyMessage(publicKey, acceptanceMessage(f), signature);
  } catch {
    return false;
  }
}

/** A new key pair, as the base64 DER strings the environment holds. */
export const generateAcceptanceKeys = generateKeys;

function read(env: NodeJS.ProcessEnv, name: string): Buffer {
  const value = env[name] ?? "";
  if (value === "") {
    throw new AcceptanceKeyError(
      `${name} is missing — generate the keys with: npm run keys:accept`,
    );
  }
  return Buffer.from(value, "base64");
}

const loadKey = (name: string, make: () => KeyObject): KeyObject =>
  ed25519Key(name, make, (message) => new AcceptanceKeyError(message));

/** The page's server only. */
export function privateKeyFromEnv(env: NodeJS.ProcessEnv = process.env): KeyObject {
  const der = read(env, PRIVATE_KEY_VAR);
  return loadKey(PRIVATE_KEY_VAR, () => privateKeyFromDer(der));
}

/** The executor. */
export function publicKeyFromEnv(env: NodeJS.ProcessEnv = process.env): KeyObject {
  const der = read(env, PUBLIC_KEY_VAR);
  return loadKey(PUBLIC_KEY_VAR, () => publicKeyFromDer(der));
}

/** A program refuses to start with another program's secret in its environment (ADR-0013). */
export function refuseSecret(
  program: string,
  name: string,
  owner: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if ((env[name] ?? "") !== "") {
    throw new AcceptanceKeyError(`${program} must not hold ${name}: only ${owner} may (ADR-0013)`);
  }
}

/** Iris and the executor refuse to start with the page's private key in their environment. */
export function refusePrivateKey(program: string, env: NodeJS.ProcessEnv = process.env): void {
  refuseSecret(program, PRIVATE_KEY_VAR, "the page's server", env);
}
