/**
 * The liaison's configuration (ADR-0048). Two files:
 * - `liaison.toml`, versioned: the switch, `[liaison] actif` — off, nothing
 *   leaves and nothing is read;
 * - `liaison.local.toml`, ignored by git: the VM's name, the account, the key,
 *   the pinned known_hosts, and the folders a demand may aim at.
 * The door (host, account, key) is the `liaison` program's alone — the
 * operator's boundary test checks that no other program parses it; the page
 * and the bot read the folders only. Errors have a closed kind, never a value.
 */
import { DOSSIER_RULE } from "@cenacle/core";
import { parse } from "smol-toml";

export const LIAISON_CONFIG_FILE = "liaison.local.toml";
export const LIAISON_SWITCH_FILE = "liaison.toml";

export const LIAISON_CONFIG_PROBLEMS = [
  "absent",
  "toml",
  "racine",
  "cle_inconnue",
  "hote",
  "compte",
  "cle",
  "known_hosts",
  "dossiers",
] as const;
export type LiaisonConfigProblem = (typeof LIAISON_CONFIG_PROBLEMS)[number];

export class LiaisonConfigError extends Error {
  readonly problem: LiaisonConfigProblem;
  constructor(problem: LiaisonConfigProblem, message: string) {
    super(message);
    this.name = "LiaisonConfigError";
    this.problem = problem;
  }
}

export interface LiaisonPorte {
  readonly hote: string;
  readonly compte: string;
  readonly cle: string;
  readonly knownHosts: string;
}

const KEYS = ["hote", "compte", "cle", "known_hosts", "dossiers"];
/** A DNS name (MagicDNS), never an address: an IP is refused. */
const HOTE =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const COMPTE = /^[a-z_][a-z0-9_-]{0,31}$/;
/** Absolute, no whitespace (ssh splits UserKnownHostsFile on it), no `..`. */
const CHEMIN = /^\/[^\s\0]{1,1023}$/;

function section(text: string): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch {
    throw new LiaisonConfigError("toml", "liaison.local.toml n'est pas du TOML lisible");
  }
  const root = raw as Record<string, unknown>;
  const s = root.liaison;
  if (Object.keys(root).length !== 1 || typeof s !== "object" || s === null || Array.isArray(s)) {
    throw new LiaisonConfigError("racine", "une seule section, [liaison], est attendue");
  }
  const table = s as Record<string, unknown>;
  for (const k of Object.keys(table)) {
    if (!KEYS.includes(k)) {
      throw new LiaisonConfigError("cle_inconnue", "clé inconnue dans [liaison]");
    }
  }
  return table;
}

function chemin(v: unknown, problem: LiaisonConfigProblem): string {
  if (typeof v !== "string" || !CHEMIN.test(v) || v.split("/").includes("..")) {
    throw new LiaisonConfigError(problem, `${problem} : un chemin absolu, sans espace`);
  }
  return v;
}

/** The `liaison` program only: how to reach the house. */
export function parseLiaisonPorte(text: string): LiaisonPorte {
  const t = section(text);
  const { hote, compte } = t;
  if (typeof hote !== "string" || !HOTE.test(hote) || IPV4.test(hote)) {
    throw new LiaisonConfigError("hote", "hote : un nom (MagicDNS), jamais une adresse");
  }
  if (typeof compte !== "string" || !COMPTE.test(compte)) {
    throw new LiaisonConfigError("compte", "compte : un nom de compte Unix");
  }
  return {
    hote,
    compte,
    cle: chemin(t.cle, "cle"),
    knownHosts: chemin(t.known_hosts, "known_hosts"),
  };
}

/** The folders a demand may aim at — what the page and the bot may read, and nothing else. */
export function parseLiaisonDossiers(text: string): readonly string[] {
  const d = section(text).dossiers;
  if (
    !Array.isArray(d) ||
    d.length === 0 ||
    d.length > 20 ||
    !d.every((x) => typeof x === "string" && DOSSIER_RULE.test(x)) ||
    new Set(d).size !== d.length
  ) {
    throw new LiaisonConfigError("dossiers", "dossiers : de 1 à 20 noms de projet, sans doublon");
  }
  return d as string[];
}

export type LiaisonSwitch = "actif" | "coupe" | "illisible";

/**
 * The versioned switch: on only when it says exactly `actif = true`; off when
 * it says `false`; anything else is unreadable — off too, but said as such.
 */
export function parseLiaisonSwitch(text: string | null): LiaisonSwitch {
  if (text === null) return "illisible";
  try {
    const root = parse(text) as Record<string, unknown>;
    const s = root.liaison as Record<string, unknown> | undefined;
    if (Object.keys(root).length !== 1 || typeof s !== "object" || s === null) return "illisible";
    if (Object.keys(s).length !== 1) return "illisible";
    if (s.actif === true) return "actif";
    if (s.actif === false) return "coupe";
    return "illisible";
  } catch {
    return "illisible";
  }
}
