/**
 * Ed25519 keys and signatures, as the environment holds them: base64 DER
 * keys, base64url signatures. From node:crypto: no dependency.
 *
 * Shared by the page's acceptance (ADR-0013) and the bot's confirmation
 * (ADR-0036): the same mechanics, two pairs of keys — never one. Each keeps
 * its own messages and its own error class.
 */
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
  verify,
} from "node:crypto";

/** An Ed25519 signature: 64 bytes, base64url. */
export const SIGNATURE_RULE = /^[A-Za-z0-9_-]{86}$/;

/** A new key pair, as the base64 DER strings the environment holds. */
export function generateKeys(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
}

export const privateKeyFromDer = (der: Buffer): KeyObject =>
  createPrivateKey({ key: der, format: "der", type: "pkcs8" });

export const publicKeyFromDer = (der: Buffer): KeyObject =>
  createPublicKey({ key: der, format: "der", type: "spki" });

/** The key `make` builds, or the caller's own error: not a key, or not an Ed25519 one. */
export function ed25519Key(
  name: string,
  make: () => KeyObject,
  fail: (message: string) => Error,
): KeyObject {
  let key: KeyObject;
  try {
    key = make();
  } catch {
    throw fail(`${name} is not a valid key`);
  }
  if (key.asymmetricKeyType !== "ed25519") throw fail(`${name} is not an Ed25519 key`);
  return key;
}

export function signMessage(privateKey: KeyObject, message: string): string {
  return sign(null, Buffer.from(message), privateKey).toString("base64url");
}

/** Never throws: anything but a valid signature of this exact message is false. */
export function verifyMessage(
  publicKey: KeyObject,
  message: string,
  signature: string | null,
): boolean {
  if (signature === null || !SIGNATURE_RULE.test(signature)) return false;
  try {
    return verify(null, Buffer.from(message), publicKey, Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}
