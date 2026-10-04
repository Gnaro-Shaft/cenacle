/**
 * Reads `cadre.toml`, the versioned, secret-free settings file.
 *
 * Deny by default: an unknown key, a wrong type or an out-of-range value is
 * an error, never ignored — a typo must not silently fall back to a default.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TIME_ZONE } from "@cenacle/core";
import { parse } from "smol-toml";
import {
  type Conservation,
  coveringTraitement,
  parseConservation,
  parseTraitements,
  type Traitement,
  TraitementError,
} from "./traitements.ts";

export const CADRE_PATH = join(import.meta.dirname, "..", "..", "..", "cadre.toml");

export interface MailCadre {
  /** The source this mailbox is, as the processings name it (ADR-0009). */
  readonly source: string;
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly mailbox: string;
  /** Where my sent mails are (read-only too): tells Iris I answered. */
  readonly sentMailbox: string;
  readonly maxPerFetch: number;
  /** Phase 4: the SMTP port of the same loopback test server (the executor only). */
  readonly smtpPort: number;
  /** My address, as the sender of the replies. A reserved test domain until phase 5. */
  readonly address: string;
}

export interface Cadre {
  readonly mail: MailCadre;
  readonly conservation: Conservation;
  /** The open processings (phase 5, C1). None while only the fictional mailbox is read. */
  readonly traitements: readonly Traitement[];
}

export class CadreError extends Error {
  constructor(message: string) {
    super(`cadre.toml: ${message}`);
    this.name = "CadreError";
  }
}

const LOOPBACK: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "::1"]);
export const MAX_PER_FETCH_LIMIT = 5000;
const MAIL_KEYS = [
  "source",
  "host",
  "port",
  "user",
  "mailbox",
  "sent_mailbox",
  "max_per_fetch",
  "smtp_port",
  "address",
] as const;
/** Domains reserved for tests (RFC 2606): nobody real can receive a mail there. */
export const TEST_DOMAIN = /\.(test|example|invalid|localhost)$/i;

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(table: Record<string, unknown>, allowed: readonly string[], where: string) {
  for (const key of Object.keys(table)) {
    if (!allowed.includes(key)) throw new CadreError(`unknown key "${key}" in ${where}`);
  }
}

function text(table: Record<string, unknown>, key: string, rule: RegExp): string {
  const value = table[key];
  if (typeof value !== "string" || !rule.test(value)) {
    throw new CadreError(`mail.${key} must be a string matching ${rule}`);
  }
  return value;
}

function integer(table: Record<string, unknown>, key: string, min: number, max: number): number {
  const value = table[key];
  // smol-toml gives numbers (or bigints for huge integers); both are checked.
  const n = typeof value === "bigint" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new CadreError(`mail.${key} must be an integer between ${min} and ${max}`);
  }
  return n;
}

function testAddress(address: string): string {
  if (!TEST_DOMAIN.test(address)) {
    throw new CadreError(
      `mail.address "${address}" refused: phase 4 sends from a test domain only`,
    );
  }
  return address;
}

/** Today in Paris, as YYYY-MM-DD: a notice dated later is not published yet. */
export const localToday = (now = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(now);

function register(raw: Record<string, unknown>, today: string) {
  try {
    return {
      conservation: parseConservation(raw.conservation),
      traitements: parseTraitements(raw.traitement, today),
    };
  } catch (error) {
    if (error instanceof TraitementError) {
      throw new CadreError(error.message.replace(/^cadre\.toml: /, ""));
    }
    throw error;
  }
}

/** Validates already-parsed TOML. Exported for tests. */
export function toCadre(raw: unknown, today = localToday()): Cadre {
  if (!isTable(raw)) throw new CadreError("not a table");
  onlyKeys(raw, ["mail", "conservation", "traitement"], "the file");
  const { conservation, traitements } = register(raw, today);
  const mail = raw.mail;
  if (!isTable(mail)) throw new CadreError("missing [mail] section");
  onlyKeys(mail, MAIL_KEYS, "[mail]");

  const source = text(mail, "source", /^[a-z][a-z0-9-]{1,40}$/);
  const host = text(mail, "host", /^[A-Za-z0-9.:-]{1,253}$/);
  const address = text(mail, "address", /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}$/);
  // Deny by default (ADR-0009): anything but the fictional mailbox of this
  // machine is a real source, read only if an open processing covers it.
  const fictional = LOOPBACK.has(host) && TEST_DOMAIN.test(address);
  if (!fictional && coveringTraitement(source, traitements) === undefined) {
    throw new CadreError(
      `mail source "${source}" is a real mailbox: no open processing covers it, it is not read`,
    );
  }
  if (!LOOPBACK.has(host)) {
    throw new CadreError(
      `mail.host "${host}" refused: a real server needs TLS and a checked certificate (phase 5, M1)`,
    );
  }
  return {
    conservation,
    traitements,
    mail: {
      source,
      host,
      port: integer(mail, "port", 1, 65535),
      user: text(mail, "user", /^[A-Za-z0-9._@+-]{1,128}$/),
      mailbox: text(mail, "mailbox", /^[A-Za-z0-9 ._/-]{1,128}$/),
      sentMailbox: text(mail, "sent_mailbox", /^[A-Za-z0-9 ._/-]{1,128}$/),
      maxPerFetch: integer(mail, "max_per_fetch", 1, MAX_PER_FETCH_LIMIT),
      smtpPort: integer(mail, "smtp_port", 1, 65535),
      address: testAddress(address),
    },
  };
}

export function parseCadre(source: string, today = localToday()): Cadre {
  let raw: unknown;
  try {
    raw = parse(source);
  } catch (error) {
    throw new CadreError(`invalid TOML (${error instanceof Error ? error.message : error})`);
  }
  return toCadre(raw, today);
}

export function loadCadre(path = CADRE_PATH): Cadre {
  return parseCadre(readFileSync(path, "utf8"));
}
