/**
 * The prospection agent's settings (ADR-0032), read strictly: an unknown key,
 * a missing list or a malformed value stops the agent, never lets it sort
 * with a default (charter, rule 3: a profile that cannot be read would let
 * every mission through).
 *
 * prospection.toml is versioned: limits, the public list of ESN, the closed
 * list of phrases that betray an intermediary. prospection.local.toml is
 * git-ignored: my platforms (their sender domain and link hosts) and my
 * profile (my rate is business data). Without it, prospection.example.toml
 * and its fictional platform are used, and the caller says so.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";
import { normalized } from "./text.ts";

export class ProspectionConfigError extends Error {
  constructor(message: string) {
    super(`prospection: ${message}`);
    this.name = "ProspectionConfigError";
  }
}

export const REMOTE_VALUES = ["total", "partiel", "aucun", "inconnu"] as const;
export type Remote = (typeof REMOTE_VALUES)[number];

export interface Platform {
  readonly name: string;
  /** The authenticated sender domain of its alerts (exact). */
  readonly senderDomain: string;
  /** The hosts its links may point to (exact): www., click tracking. */
  readonly linkHosts: ReadonlySet<string>;
}

export interface Profile {
  /** Normalized words: at least one must be in a mission's stack. */
  readonly stack: ReadonlySet<string>;
  /** Euros a day: a mission whose maximum is lower stops. */
  readonly minRate: number;
  readonly remote: ReadonlySet<Remote>;
  /** Normalized places accepted when the remote work is not. */
  readonly places: ReadonlySet<string>;
}

export interface ProspectionConfig {
  /** Characters of a mail's text shown to the model at most. */
  readonly textMax: number;
  /** Missions read from one mail at most; more are counted, never kept. */
  readonly perMailMax: number;
  /** Normalized ESN names, compared as whole words. */
  readonly esn: readonly string[];
  /** Normalized phrases that betray an intermediary. */
  readonly phrases: readonly string[];
  readonly platforms: readonly Platform[];
  readonly profile: Profile;
  /** True when prospection.local.toml is absent and the fictional example is used. */
  readonly example: boolean;
}

type Table = Record<string, unknown>;
const isTable = (v: unknown): v is Table =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function onlyKeys(table: Table, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(table)) {
    if (!allowed.includes(key))
      throw new ProspectionConfigError(`unknown key "${key}" in ${where}`);
  }
}

function section(raw: Table, key: string, where: string): Table {
  const value = raw[key];
  if (!isTable(value)) throw new ProspectionConfigError(`missing [${key}] in ${where}`);
  return value;
}

function integer(t: Table, key: string, where: string, min: number, max: number): number {
  const v = t[key];
  const n = typeof v === "bigint" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new ProspectionConfigError(`${where}.${key} must be an integer from ${min} to ${max}`);
  }
  return n;
}

function words(t: Table, key: string, where: string, max: number, required = true): string[] {
  const v = t[key];
  if (v === undefined && !required) return [];
  if (!Array.isArray(v) || (required && v.length === 0) || v.length > max) {
    throw new ProspectionConfigError(`${where}.${key} must be a list of 1 to ${max} texts`);
  }
  return v.map((item) => {
    if (typeof item !== "string" || item.trim() === "" || item.length > 80) {
      throw new ProspectionConfigError(
        `${where}.${key}: ${JSON.stringify(item)} is not a short text`,
      );
    }
    return normalized(item);
  });
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
function host(value: unknown, where: string): string {
  const labels = typeof value === "string" ? value.split(".") : [];
  if (typeof value !== "string" || labels.length < 2 || !labels.every((l) => LABEL.test(l))) {
    throw new ProspectionConfigError(`${where}: ${JSON.stringify(value)} is not an exact host`);
  }
  return value;
}

function platforms(raw: Table, where: string): Platform[] {
  const list = raw.plateforme;
  if (!Array.isArray(list) || list.length === 0 || list.length > 20) {
    throw new ProspectionConfigError(`${where} must declare 1 to 20 [[plateforme]]`);
  }
  const seen = new Set<string>();
  return list.map((p, i) => {
    const at = `${where} [[plateforme]] #${i + 1}`;
    if (!isTable(p)) throw new ProspectionConfigError(`${at} must be a table`);
    onlyKeys(p, ["nom", "domaine", "hotes_liens"], at);
    if (typeof p.nom !== "string" || p.nom.trim() === "" || p.nom.length > 40) {
      throw new ProspectionConfigError(`${at}.nom must be a short text`);
    }
    const senderDomain = host(p.domaine, `${at}.domaine`);
    if (seen.has(senderDomain)) {
      throw new ProspectionConfigError(`${senderDomain} is declared twice`);
    }
    seen.add(senderDomain);
    const hosts = p.hotes_liens;
    if (!Array.isArray(hosts) || hosts.length === 0 || hosts.length > 10) {
      throw new ProspectionConfigError(`${at}.hotes_liens must list 1 to 10 hosts`);
    }
    return {
      name: p.nom.trim(),
      senderDomain,
      linkHosts: new Set(hosts.map((h) => host(h, `${at}.hotes_liens`))),
    };
  });
}

function profile(raw: Table, where: string): Profile {
  const p = section(raw, "profil", where);
  onlyKeys(p, ["stack", "tjm_min", "teletravail", "lieux"], `${where} [profil]`);
  const remote = p.teletravail;
  if (!Array.isArray(remote) || remote.length === 0) {
    throw new ProspectionConfigError(`${where} [profil].teletravail must list accepted values`);
  }
  for (const r of remote) {
    if (!(REMOTE_VALUES as readonly unknown[]).includes(r) || r === "inconnu") {
      throw new ProspectionConfigError(
        `${where} [profil].teletravail: ${JSON.stringify(r)} is not one of total, partiel, aucun`,
      );
    }
  }
  return {
    stack: new Set(words(p, "stack", `${where} [profil]`, 50)),
    minRate: integer(p, "tjm_min", `${where} [profil]`, 0, 5000),
    remote: new Set(remote as Remote[]),
    places: new Set(words(p, "lieux", `${where} [profil]`, 30, false)),
  };
}

function parseToml(source: string, where: string): Table {
  try {
    const raw = parse(source);
    if (!isTable(raw)) throw new ProspectionConfigError(`${where} is not a table`);
    return raw;
  } catch (error) {
    if (error instanceof ProspectionConfigError) throw error;
    throw new ProspectionConfigError(`${where}: invalid TOML (${(error as Error).message})`);
  }
}

/** Both files, already read. Exported for tests. */
export function parseProspectionConfig(
  shared: string,
  local: string,
  example = false,
): ProspectionConfig {
  const s = parseToml(shared, "prospection.toml");
  onlyKeys(s, ["reglage", "intermediaires"], "prospection.toml");
  const reglage = section(s, "reglage", "prospection.toml");
  onlyKeys(reglage, ["texte_max", "annonces_max"], "prospection.toml [reglage]");
  const shown = section(s, "intermediaires", "prospection.toml");
  onlyKeys(shown, ["esn", "tournures"], "prospection.toml [intermediaires]");

  const where = example ? "prospection.example.toml" : "prospection.local.toml";
  const l = parseToml(local, where);
  onlyKeys(l, ["plateforme", "profil", "intermediaires"], where);
  const added = l.intermediaires === undefined ? {} : section(l, "intermediaires", where);
  onlyKeys(added, ["esn"], `${where} [intermediaires]`);

  return {
    textMax: integer(reglage, "texte_max", "[reglage]", 1000, 20_000),
    perMailMax: integer(reglage, "annonces_max", "[reglage]", 1, 100),
    esn: [
      ...words(shown, "esn", "[intermediaires]", 500),
      ...words(added, "esn", `${where} [intermediaires]`, 500, false),
    ],
    phrases: words(shown, "tournures", "[intermediaires]", 100),
    platforms: platforms(l, where),
    profile: profile(l, where),
    example,
  };
}

const ROOT = join(import.meta.dirname, "..", "..", "..");

export function loadProspectionConfig(root = ROOT): ProspectionConfig {
  const localPath = join(root, "prospection.local.toml");
  const example = !existsSync(localPath);
  return parseProspectionConfig(
    readFileSync(join(root, "prospection.toml"), "utf8"),
    readFileSync(example ? join(root, "prospection.example.toml") : localPath, "utf8"),
    example,
  );
}
