/**
 * Pseudonymous keys (GDPR art. 4(5)): what Iris remembers instead of
 * addresses and message identifiers.
 *
 * A key is an HMAC-SHA256 under a secret that lives only in .env. Without the
 * secret, a key cannot be turned back into an address — not even by trying
 * every known address, which a plain hash would allow. With it, Iris can still
 * tell that two mails come from the same person or belong to the same thread.
 */
import { createHmac } from "node:crypto";

const SECRET_RULE = /^[0-9a-f]{64}$/;
const MAX_IDS = 50;
const MAX_ID_LENGTH = 250;

export class KeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyError";
  }
}

export interface Keyer {
  /** Key of a lowercased e-mail address. */
  address(address: string): string;
  /** Key of a Message-ID, without its angle brackets. */
  messageId(id: string): string;
  /** Key of a folder path: folder names may name clients, so they are never stored. */
  folder(path: string): string;
}

export function createKeyer(secretHex: string): Keyer {
  if (!SECRET_RULE.test(secretHex)) {
    throw new KeyError("CENACLE_MAIL_KEY must be 64 hex characters (openssl rand -hex 32)");
  }
  const secret = Buffer.from(secretHex, "hex");
  // The kind is part of the input, so an address and an id never share a key.
  const key = (kind: string, value: string) =>
    createHmac("sha256", secret).update(`${kind}\u0000${value}`).digest("hex");
  return {
    address: (address) => key("address", address.toLowerCase()),
    messageId: (id) => key("message-id", id),
    folder: (path) => key("folder", path),
  };
}

export function keyerFromEnv(env: NodeJS.ProcessEnv = process.env): Keyer {
  const secret = env.CENACLE_MAIL_KEY;
  if (secret === undefined || secret === "") {
    throw new KeyError("CENACLE_MAIL_KEY is missing (see .env.example)");
  }
  return createKeyer(secret);
}

/**
 * The Message-IDs found in a Message-ID / In-Reply-To / References header:
 * every `<...>` token, bounded in number and length. Anything else is ignored.
 */
export function messageIds(raw: string | null | undefined): string[] {
  if (typeof raw !== "string") return [];
  const ids: string[] = [];
  for (const match of raw.matchAll(/<([^<>\s]{1,998})>/g)) {
    const id = match[1];
    if (id !== undefined && id.length <= MAX_ID_LENGTH && !ids.includes(id)) ids.push(id);
    if (ids.length >= MAX_IDS) break;
  }
  return ids;
}
