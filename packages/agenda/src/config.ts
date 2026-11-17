/**
 * The agenda's accounts (ADR-0042, point 5), from agenda.local.toml
 * (git-ignored), read again at each reading: no restart after a change. An
 * account not declared is not read. Each account: a name I choose, its server
 * (https only), its login, the hosts admitted besides the server's own — named,
 * never a joker nor a computed neighbourhood — and the calendars not to read,
 * by their displayed name. Its password comes from .env.agenda.
 *
 * A wrong file is said with the field at fault, never a value. Two declarations
 * of one account (same host, same login, whatever their names) are refused:
 * its appointments would come twice with nothing to say so.
 */
import { readFileSync } from "node:fs";
import { agendaPasswordVar } from "@cenacle/core";
import { parse } from "smol-toml";
import { ACCOUNT_NAME_RULE } from "./prise-protocole.ts";

export const MAX_ACCOUNTS = 8;
const NAME_RULE = ACCOUNT_NAME_RULE;
const HOST_RULE =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const ACCOUNT_KEYS = new Set(["nom", "serveur", "identifiant", "hotes", "exclus"]);

export interface AgendaAccount {
  readonly name: string;
  readonly server: URL;
  readonly login: string;
  /** Who may receive the password: `host[:port]` as a URL names it, the server's first. */
  readonly admitted: ReadonlySet<string>;
  /** Calendars not read, by their displayed name. */
  readonly excluded: ReadonlySet<string>;
  /** From .env.agenda; null when absent — the account is then said, not read. */
  readonly password: string | null;
}

export type AgendaConfig =
  | { readonly read: "absent" }
  | { readonly read: "config"; readonly why: string }
  | { readonly read: "ok"; readonly accounts: readonly AgendaAccount[] };

/** A displayed name as compared: trimmed, NFC. */
export function calendarKey(name: string): string {
  return name.normalize("NFC").trim();
}

function strings(value: unknown, max: number, each: number): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) return null;
  if (!value.every((v) => typeof v === "string" && v.length > 0 && v.length <= each)) return null;
  return value as string[];
}

function account(
  raw: unknown,
  at: number,
  env: NodeJS.ProcessEnv,
): AgendaAccount | { why: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { why: `compte n°${at} : ce n'est pas une table` };
  }
  const t = raw as Record<string, unknown>;
  const name = t.nom;
  if (typeof name !== "string" || !NAME_RULE.test(name)) {
    return { why: `compte n°${at} : nom absent ou hors de [a-z][a-z0-9_], 24 caractères au plus` };
  }
  const where = `compte « ${name} »`;
  const unknown = Object.keys(t).filter((k) => !ACCOUNT_KEYS.has(k));
  if (unknown.length > 0) return { why: `${where} : clé inconnue (${unknown.sort().join(", ")})` };
  let server: URL;
  try {
    if (typeof t.serveur !== "string" || t.serveur.length > 512) throw new Error("serveur");
    server = new URL(t.serveur);
  } catch {
    return { why: `${where} : serveur n'est pas une adresse` };
  }
  if (
    server.protocol !== "https:" ||
    server.username !== "" ||
    server.password !== "" ||
    server.search !== "" ||
    server.hash !== ""
  ) {
    return {
      why: `${where} : serveur doit être une adresse https, sans identifiant ni « ? » ni « # »`,
    };
  }
  const login = t.identifiant;
  if (
    typeof login !== "string" ||
    login.length === 0 ||
    login.length > 254 ||
    login.includes(":") ||
    /\p{Cc}/u.test(login)
  ) {
    return { why: `${where} : identifiant absent, trop long, ou avec « : »` };
  }
  const hosts = strings(t.hotes, 8, 253);
  if (hosts === null || !hosts.every((h) => HOST_RULE.test(h))) {
    return {
      why: `${where} : hotes doit lister des noms d'hôte exacts, en minuscules (8 au plus)`,
    };
  }
  const excluded = strings(t.exclus, 64, 200);
  if (excluded === null) return { why: `${where} : exclus doit lister des noms de calendrier` };
  const password = env[agendaPasswordVar(name)] ?? "";
  return {
    name,
    server,
    login,
    admitted: new Set([server.host, ...hosts]),
    excluded: new Set(excluded.map(calendarKey)),
    password: password === "" ? null : password,
  };
}

/** The accounts of agenda.local.toml's text; null text: no file, nothing to read. */
export function parseAgendaConfig(text: string | null, env: NodeJS.ProcessEnv): AgendaConfig {
  if (text === null) return { read: "absent" };
  let doc: Record<string, unknown>;
  try {
    doc = parse(text) as Record<string, unknown>;
  } catch {
    return { read: "config", why: "agenda.local.toml n'est pas du TOML lisible" };
  }
  const extra = Object.keys(doc).filter((k) => k !== "compte");
  if (extra.length > 0) {
    return { read: "config", why: `clé inconnue au premier niveau (${extra.sort().join(", ")})` };
  }
  const raw = doc.compte ?? [];
  if (!Array.isArray(raw)) return { read: "config", why: "compte doit être une liste [[compte]]" };
  if (raw.length > MAX_ACCOUNTS) {
    return { read: "config", why: `${MAX_ACCOUNTS} comptes au plus` };
  }
  const accounts: AgendaAccount[] = [];
  for (const [i, entry] of raw.entries()) {
    const a = account(entry, i + 1, env);
    if ("why" in a) return { read: "config", why: a.why };
    if (accounts.some((b) => b.name === a.name)) {
      return { read: "config", why: `deux comptes nommés « ${a.name} »` };
    }
    const twin = accounts.find(
      (b) =>
        b.server.hostname === a.server.hostname && b.login.toLowerCase() === a.login.toLowerCase(),
    );
    if (twin !== undefined) {
      return {
        read: "config",
        why: `« ${twin.name} » et « ${a.name} » déclarent le même compte (même hôte, même identifiant)`,
      };
    }
    accounts.push(a);
  }
  return { read: "ok", accounts };
}

/** The file's text, or null when there is none; a file that cannot be read is said. */
export function loadAgendaConfig(path: string, env: NodeJS.ProcessEnv): AgendaConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { read: "absent" };
    return { read: "config", why: "agenda.local.toml ne peut pas être lu" };
  }
  return parseAgendaConfig(text, env);
}
