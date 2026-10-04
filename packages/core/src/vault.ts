/**
 * The encrypted backup of the secret files (phase 5, S1). Losing
 * CENACLE_MAIL_KEY makes the mail memory useless, losing the page's key makes
 * every acceptance not yet sent fail: the secrets are kept, encrypted, away
 * from the Mac (a USB key, for instance).
 *
 * scrypt derives the key from a passphrase; AES-256-GCM encrypts and
 * authenticates, so a wrong passphrase or a tampered file is refused, never
 * half-read. node:crypto only, no dependency.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const MAGIC = "cenacle-secrets-v1";
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 } as const;
export const MIN_PASSPHRASE = 12;

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

const keyOf = (passphrase: string, salt: Buffer) => scryptSync(passphrase, salt, 32, SCRYPT);

/** Seals file name → content into one encrypted document. */
export function sealSecrets(files: Readonly<Record<string, string>>, passphrase: string): string {
  if (passphrase.length < MIN_PASSPHRASE) {
    throw new VaultError(`the passphrase needs ${MIN_PASSPHRASE} characters at least`);
  }
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyOf(passphrase, salt), iv);
  cipher.setAAD(Buffer.from(MAGIC));
  const body = Buffer.concat([cipher.update(JSON.stringify(files), "utf8"), cipher.final()]);
  return `${JSON.stringify({
    magic: MAGIC,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    body: body.toString("base64"),
  })}\n`;
}

/** Opens a sealed document; a wrong passphrase or any change to it is refused. */
export function openSecrets(document: string, passphrase: string): Record<string, string> {
  let sealed: { magic?: unknown; salt?: unknown; iv?: unknown; tag?: unknown; body?: unknown };
  try {
    sealed = JSON.parse(document);
  } catch {
    throw new VaultError("not a Cénacle secrets backup");
  }
  const { magic, salt, iv, tag, body } = sealed;
  if (
    magic !== MAGIC ||
    typeof salt !== "string" ||
    typeof iv !== "string" ||
    typeof tag !== "string" ||
    typeof body !== "string"
  ) {
    throw new VaultError("not a Cénacle secrets backup");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyOf(passphrase, Buffer.from(salt, "base64")),
      Buffer.from(iv, "base64"),
    );
    decipher.setAAD(Buffer.from(MAGIC));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    const text = Buffer.concat([
      decipher.update(Buffer.from(body, "base64")),
      decipher.final(),
    ]).toString("utf8");
    const files: unknown = JSON.parse(text);
    if (typeof files !== "object" || files === null || Array.isArray(files)) throw new Error();
    return files as Record<string, string>;
  } catch {
    // Same answer whatever went wrong: wrong passphrase or tampered file.
    throw new VaultError("wrong passphrase, or the backup was altered");
  }
}
