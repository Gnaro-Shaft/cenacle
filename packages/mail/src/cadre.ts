/**
 * Reads `cadre.toml`, the versioned, secret-free settings file.
 *
 * Deny by default: an unknown key, a wrong type or an out-of-range value is
 * an error, never ignored — a typo must not silently fall back to a default.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";

export const CADRE_PATH = join(import.meta.dirname, "..", "..", "..", "cadre.toml");

export interface MailCadre {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly mailbox: string;
  readonly maxPerFetch: number;
}

export interface Cadre {
  readonly mail: MailCadre;
}

export class CadreError extends Error {
  constructor(message: string) {
    super(`cadre.toml: ${message}`);
    this.name = "CadreError";
  }
}

const LOOPBACK: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "::1"]);
export const MAX_PER_FETCH_LIMIT = 5000;
const MAIL_KEYS = ["host", "port", "user", "mailbox", "max_per_fetch"] as const;

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

/** Validates already-parsed TOML. Exported for tests. */
export function toCadre(raw: unknown): Cadre {
  if (!isTable(raw)) throw new CadreError("not a table");
  onlyKeys(raw, ["mail"], "the file");
  const mail = raw.mail;
  if (!isTable(mail)) throw new CadreError("missing [mail] section");
  onlyKeys(mail, MAIL_KEYS, "[mail]");

  const host = text(mail, "host", /^[A-Za-z0-9.:-]{1,253}$/);
  if (!LOOPBACK.has(host)) {
    throw new CadreError(
      `mail.host "${host}" refused: phase 2 reads the test mailbox on this machine only`,
    );
  }
  return {
    mail: {
      host,
      port: integer(mail, "port", 1, 65535),
      user: text(mail, "user", /^[A-Za-z0-9._@+-]{1,128}$/),
      mailbox: text(mail, "mailbox", /^[A-Za-z0-9 ._/-]{1,128}$/),
      maxPerFetch: integer(mail, "max_per_fetch", 1, MAX_PER_FETCH_LIMIT),
    },
  };
}

export function parseCadre(source: string): Cadre {
  let raw: unknown;
  try {
    raw = parse(source);
  } catch (error) {
    throw new CadreError(`invalid TOML (${error instanceof Error ? error.message : error})`);
  }
  return toCadre(raw);
}

export function loadCadre(path = CADRE_PATH): Cadre {
  return parseCadre(readFileSync(path, "utf8"));
}
