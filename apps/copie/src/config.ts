/**
 * What the nightly copy needs to know (ADR-0044), read from copie.local.toml
 * (git-ignored): the age PUBLIC key it encrypts for, and where it pushes.
 * Nothing secret: a private key pasted here by mistake is refused, never
 * repeated. The push key is no setting: one fixed file, named here alone.
 */
import { isAbsolute, join, normalize } from "node:path";
import { parse } from "smol-toml";

export const COPIE_FILE = "copie.local.toml";

/** The push key (ADR-0044, point 3): this file names it, and no other source does. */
export function pushKeyPath(home: string): string {
  return join(home, ".ssh", "cenacle", "copie-pousser");
}

export interface CopieConfig {
  /** The age recipient: a public key, age1… */
  readonly recipient: string;
  /** Cénacle's own known_hosts, the backup node's fingerprint pinned in it. */
  readonly knownHosts: string;
  /** The backup node's host name. */
  readonly address: string;
  readonly port: number;
  /** The account whose key is locked on rrsync -wo, never root. */
  readonly account: string;
}

export class CopieConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CopieConfigError";
  }
}

const KEYS = ["destinataire", "known_hosts", "adresse", "port", "compte"];
/** An age X25519 recipient: bech32, "age1" and 58 characters of its alphabet. */
const RECIPIENT = /^age1[02-9ac-hj-np-z]{58}$/;
const ADDRESS = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,62})(?:\.[A-Za-z0-9-]{1,63}){0,10}$/;
const ACCOUNT = /^[a-z_][a-z0-9_-]{0,31}$/;

/**
 * A path the ssh command line can carry as one word: absolute, normalised,
 * and without a space, a quote, a backslash or a control character (rsync
 * splits its -e command on spaces and reads quotes).
 */
export function plainWord(p: unknown, what: string): string {
  if (
    typeof p !== "string" ||
    !isAbsolute(p) ||
    p.length > 300 ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters
    /[\s"'`\\$\u0000-\u001f\u007f]/.test(p) ||
    normalize(p) !== p
  ) {
    throw new CopieConfigError(`${what} must be a plain absolute path, without space or quote`);
  }
  return p;
}

export function parseCopieConfig(text: string): CopieConfig {
  let data: Record<string, unknown>;
  try {
    data = parse(text) as Record<string, unknown>;
  } catch {
    throw new CopieConfigError("not valid TOML");
  }
  // Never named: a key is the file's text, and the log repeats none of it.
  if (Object.keys(data).some((k) => !KEYS.includes(k))) {
    throw new CopieConfigError(`only ${KEYS.join(", ")} are expected`);
  }
  const { destinataire, adresse, port = 22, compte } = data;
  if (typeof destinataire === "string" && /^AGE-SECRET-KEY-/i.test(destinataire.trim())) {
    // Said by its kind only: the value is never repeated.
    throw new CopieConfigError(
      "destinataire is a PRIVATE key: remove it from this file, and keep it off the Mac",
    );
  }
  if (typeof destinataire !== "string" || !RECIPIENT.test(destinataire)) {
    throw new CopieConfigError("destinataire must be an age public key (age1…)");
  }
  if (typeof adresse !== "string" || !ADDRESS.test(adresse)) {
    throw new CopieConfigError("adresse must be a host name");
  }
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CopieConfigError("port must be a whole number from 1 to 65535");
  }
  if (typeof compte !== "string" || !ACCOUNT.test(compte) || compte === "root") {
    throw new CopieConfigError("compte must be a plain account, never root");
  }
  return {
    recipient: destinataire,
    knownHosts: plainWord(data.known_hosts, "known_hosts"),
    address: adresse,
    port,
    account: compte,
  };
}
