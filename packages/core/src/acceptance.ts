/**
 * My acceptance of a proposal, signed by the page (ADR-0013).
 *
 * The page's server alone holds the private key; the executor holds the
 * public key and only verifies; Iris holds neither. The signature covers the
 * proposal, its mail and the SHA-256 of the exact text I accepted, so a
 * proposal accepted without the page, or whose text changed afterwards, is
 * never sent. Ed25519, from node:crypto: no dependency.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
  verify,
} from "node:crypto";

export const PRIVATE_KEY_VAR = "CENACLE_ACCEPT_PRIVATE_KEY";
export const PUBLIC_KEY_VAR = "CENACLE_ACCEPT_PUBLIC_KEY";
const VERSION = "cenacle-accept-v1";
/** An Ed25519 signature: 64 bytes, base64url. */
const SIGNATURE_RULE = /^[A-Za-z0-9_-]{86}$/;

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
  return sign(null, Buffer.from(acceptanceMessage(f)), privateKey).toString("base64url");
}

/** Never throws: anything but a valid signature of these exact fields is false. */
export function verifyAcceptance(
  publicKey: KeyObject,
  f: AcceptanceFields,
  signature: string | null,
): boolean {
  if (signature === null || !SIGNATURE_RULE.test(signature)) return false;
  try {
    return verify(
      null,
      Buffer.from(acceptanceMessage(f)),
      publicKey,
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

/** A new key pair, as the base64 DER strings the environment holds. */
export function generateAcceptanceKeys(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
}

function read(env: NodeJS.ProcessEnv, name: string): Buffer {
  const value = env[name] ?? "";
  if (value === "") {
    throw new AcceptanceKeyError(
      `${name} is missing — generate the keys with: npm run keys:accept`,
    );
  }
  return Buffer.from(value, "base64");
}

function loadKey(name: string, make: () => KeyObject): KeyObject {
  let key: KeyObject;
  try {
    key = make();
  } catch {
    throw new AcceptanceKeyError(`${name} is not a valid key`);
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new AcceptanceKeyError(`${name} is not an Ed25519 key`);
  }
  return key;
}

/** The page's server only. */
export function privateKeyFromEnv(env: NodeJS.ProcessEnv = process.env): KeyObject {
  const der = read(env, PRIVATE_KEY_VAR);
  return loadKey(PRIVATE_KEY_VAR, () =>
    createPrivateKey({ key: der, format: "der", type: "pkcs8" }),
  );
}

/** The executor. */
export function publicKeyFromEnv(env: NodeJS.ProcessEnv = process.env): KeyObject {
  const der = read(env, PUBLIC_KEY_VAR);
  return loadKey(PUBLIC_KEY_VAR, () => createPublicKey({ key: der, format: "der", type: "spki" }));
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
