/**
 * Reads `cadre.toml`, the versioned, secret-free settings file.
 *
 * Deny by default: an unknown key, a wrong type or an out-of-range value is
 * an error, never ignored — a typo must not silently fall back to a default.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TIME_ZONE, zonedMidnight } from "@cenacle/core";
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
/** The real configuration (host, account, addresses), git-ignored: replaces cadre.toml when present. */
export const LOCAL_CADRE_PATH = join(import.meta.dirname, "..", "..", "..", "cadre.local.toml");

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
  /** My address, as the sender of the replies (a reserved test domain for the fictional box). */
  readonly address: string;
  /** A test mailbox (fictional, or a real one marked `test = true`): the only kind fixtures may be loaded into. */
  readonly test: boolean;
  /**
   * The only addresses a reply may go to ([envoi] destinataires, M1-M2): my own.
   * Null for the fictional box: reserved test domains only.
   */
  readonly recipients: readonly string[] | null;
  /**
   * A real mailbox not marked `test = true` (phase 5, M2): sorted and followed,
   * never drafted for nor sent from. Lifting it is M3's decision, not a default.
   */
  readonly readOnly: boolean;
}

export interface Cadre {
  readonly mail: MailCadre;
  readonly conservation: Conservation;
  /** The open processings (phase 5, C1). None while only the fictional mailbox is read. */
  readonly traitements: readonly Traitement[];
}

/** Something that writes or drafts was asked of a read-only mailbox (M2). */
export class ReadOnlyMailboxError extends Error {
  constructor(what: string) {
    super(`${what} refused: this mailbox is read-only (a real box, M2 — no draft, no sending)`);
    this.name = "ReadOnlyMailboxError";
  }
}

/** The second line of the M2 lock: each writer checks it itself. */
export function refuseReadOnly(mail: Pick<MailCadre, "readOnly">, what: string): void {
  if (mail.readOnly !== false) throw new ReadOnlyMailboxError(what);
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
  "test",
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

/**
 * From when the mailbox may be read (phase 5, C4): midnight, Paris time, of
 * the day the information notice of its processing was published. Nobody
 * could be informed of a processing that did not exist yet: what arrived
 * before is not read. Null for the fictional test mailbox (no processing),
 * and for a processing without third parties' data (`tiers = false`, like the
 * real test box T-08): there is nobody to inform.
 */
export function readingStartsAt(cadre: Cadre): Date | null {
  const treatment = coveringTraitement(cadre.mail.source, cadre.traitements);
  if (treatment === undefined || !treatment.tiers) return null;
  const [y = 0, m = 0, d = 0] = treatment.mentionPubliee.split("-").map(Number);
  return new Date(zonedMidnight(y, m, d, TIME_ZONE));
}

const PLAIN_ADDRESS = /^[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,63}$/;

/** [envoi] destinataires: a non-empty list of plain addresses, required for a real box. */
function closedRecipients(raw: unknown): string[] {
  if (!isTable(raw)) {
    throw new CadreError(
      "a real mailbox needs [envoi] destinataires: the only addresses a reply may go to",
    );
  }
  onlyKeys(raw, ["destinataires"], "[envoi]");
  const list = raw.destinataires;
  if (!Array.isArray(list) || list.length === 0 || list.length > 20) {
    throw new CadreError("envoi.destinataires must list 1 to 20 addresses");
  }
  return list.map((a) => {
    if (typeof a !== "string" || !PLAIN_ADDRESS.test(a)) {
      throw new CadreError(`envoi.destinataires: invalid address ${JSON.stringify(a)}`);
    }
    return a.toLowerCase();
  });
}

/** Validates already-parsed TOML. Exported for tests. */
export function toCadre(raw: unknown, today = localToday()): Cadre {
  if (!isTable(raw)) throw new CadreError("not a table");
  onlyKeys(raw, ["mail", "conservation", "traitement", "envoi"], "the file");
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
  // A real server is always reached over TLS with its certificate checked (connection.ts).
  // A real box sends only to a closed list of my own addresses until M3.
  const recipients = fictional ? null : closedRecipients(raw.envoi);
  const test = mail.test ?? false;
  if (typeof test !== "boolean") throw new CadreError("mail.test must be true or false");
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
      address: fictional ? testAddress(address) : address,
      test: fictional || test,
      recipients,
      readOnly: !fictional && !test,
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

export function loadCadre(
  path = existsSync(LOCAL_CADRE_PATH) ? LOCAL_CADRE_PATH : CADRE_PATH,
): Cadre {
  return parseCadre(readFileSync(path, "utf8"));
}

/** The mailbox password: the fictional box's, or the real one's (both in .env.mail). */
export function mailPassword(cadre: Cadre, env: NodeJS.ProcessEnv = process.env): string {
  const name =
    cadre.mail.recipients === null ? "CENACLE_TEST_MAIL_PASSWORD" : "CENACLE_MAIL_PASSWORD";
  const value = env[name] ?? "";
  if (value === "") throw new CadreError(`${name} is missing (.env.mail)`);
  return value;
}
