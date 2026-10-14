/**
 * Acting on the servers (J6f, ADR-0027) — what the operator needs, pure: the
 * closed catalogue (an action answers one kind of finding and has one script
 * on the server); my machines (serveurs.local.toml, git-ignored: names,
 * addresses, accounts, paths of the keys); the general switch (securite.toml,
 * off by default); the ssh arguments, fixed — the server imposes its own
 * command, none is ever sent; and what an exit code means. The script on the
 * server decides; the Mac only asks.
 */
import { isAbsolute, normalize } from "node:path";
import { parse } from "smol-toml";
import type { Observation } from "./types.ts";

export type ServerActionName = "services" | "redemarrer" | "maj_securite";

export const SERVER_CATALOGUE: Readonly<
  Record<
    ServerActionName,
    { readonly finding: string; readonly script: string; readonly label: string }
  >
> = {
  services: {
    finding: "serveur_services",
    script: "cenacle-services",
    label: "relancer les services sur une bibliothèque remplacée",
  },
  // J6f2: a reboot, scheduled one minute on; once in 24 hours, never losing the cluster's quorum.
  redemarrer: {
    finding: "serveur_redemarrage",
    script: "cenacle-redemarrer",
    label: "redémarrer la machine",
  },
  // J6f3: the security updates, started in the background on the server; never a reboot.
  maj_securite: {
    finding: "serveur_maj_securite",
    script: "cenacle-maj-securite",
    label: "appliquer les mises à jour de sécurité",
  },
};

/** The action of the catalogue that answers this kind of finding, if any. */
export function serverActionFor(findingType: string): ServerActionName | null {
  for (const [name, entry] of Object.entries(SERVER_CATALOGUE)) {
    if (entry.finding === findingType) return name as ServerActionName;
  }
  return null;
}

/** The script's answer: its exit code, nothing else is read. */
export const EXIT = { done: 0, nothing: 10, refused: 11, failed: 12, ssh: 255 } as const;
export type RunOutcome = "faite" | "rien_a_faire" | "refusee_serveur" | "echouee";
export const outcomeOf = (code: number): RunOutcome =>
  code === EXIT.done
    ? "faite"
    : code === EXIT.nothing
      ? "rien_a_faire"
      : code === EXIT.refused
        ? "refusee_serveur"
        : "echouee";

export interface Server {
  /** As Legion's verdict names it (the finding's host). */
  readonly name: string;
  readonly address: string;
  readonly account: string;
  readonly keys: Readonly<Partial<Record<ServerActionName, string>>>;
}
export interface ServersConfig {
  readonly knownHosts: string;
  readonly servers: readonly Server[];
}

/**
 * What can be wrong with serveurs.local.toml, as a closed list: the operator
 * stores it as its refusal and names it on Telegram, where neither a value nor
 * a block number goes ("absent" is the operator's, never thrown here).
 */
export const SERVERS_CONFIG_PROBLEMS = [
  "absent",
  "toml",
  "racine",
  "trop",
  "bloc",
  "cle_inconnue",
  "nom",
  "adresse",
  "compte",
  "cles",
  "action",
  "partagee",
  "chemin",
] as const;
export type ServersConfigProblem = (typeof SERVERS_CONFIG_PROBLEMS)[number];

export class ServersConfigError extends Error {
  readonly problem: Exclude<ServersConfigProblem, "absent">;
  constructor(problem: Exclude<ServersConfigProblem, "absent">, message: string) {
    super(`serveurs.local.toml: ${message}`);
    this.name = "ServersConfigError";
    this.problem = problem;
  }
}

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** A host name or an IPv4 address: never an option, a user, a port or a space. */
const ADDRESS =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)*$/;
const ACCOUNT = /^[a-z_][a-z0-9_-]{0,31}$/;

function plainPath(p: unknown, what: string): string {
  if (
    typeof p !== "string" ||
    !isAbsolute(p) ||
    p.length > 300 ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters
    /[\u0000-\u001f\u007f]/.test(p) ||
    p.split("/").includes("..") ||
    normalize(p) !== p
  ) {
    throw new ServersConfigError("chemin", `${what} must be a plain absolute path`);
  }
  return p;
}

const table = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function parseServers(text: string): ServersConfig {
  let data: Record<string, unknown>;
  try {
    data = parse(text) as Record<string, unknown>;
  } catch {
    throw new ServersConfigError("toml", "not valid TOML");
  }
  if (Object.keys(data).some((k) => k !== "known_hosts" && k !== "serveur")) {
    throw new ServersConfigError("racine", "only known_hosts and [[serveur]] are expected");
  }
  const knownHosts = plainPath(data.known_hosts, "known_hosts");
  const list = data.serveur ?? [];
  if (!Array.isArray(list))
    throw new ServersConfigError("bloc", "serveur must be [[serveur]] blocks");
  if (list.length > 20) throw new ServersConfigError("trop", "[[serveur]], 20 at most");
  const names = new Set<string>();
  const servers = list.map((raw, i): Server => {
    const at = `serveur n°${i + 1}`;
    if (!table(raw)) throw new ServersConfigError("bloc", `${at} is not a table`);
    if (Object.keys(raw).some((k) => !["nom", "adresse", "compte", "cles"].includes(k))) {
      throw new ServersConfigError("cle_inconnue", `${at}: unknown key`);
    }
    const { nom, adresse, compte, cles } = raw;
    if (typeof nom !== "string" || !NAME.test(nom))
      throw new ServersConfigError("nom", `${at}: nom`);
    if (names.has(nom)) throw new ServersConfigError("nom", `${at}: nom ${nom} twice`);
    names.add(nom);
    if (typeof adresse !== "string" || !ADDRESS.test(adresse)) {
      throw new ServersConfigError("adresse", `${at}: adresse must be a host name`);
    }
    if (typeof compte !== "string" || !ACCOUNT.test(compte) || compte === "root") {
      throw new ServersConfigError("compte", `${at}: compte must be a plain account, never root`);
    }
    if (!table(cles)) throw new ServersConfigError("cles", `${at}: cles must be a table`);
    const keys: Partial<Record<ServerActionName, string>> = {};
    for (const [action, path] of Object.entries(cles)) {
      if (!Object.hasOwn(SERVER_CATALOGUE, action)) {
        throw new ServersConfigError(
          "action",
          `${at}: no action "${action.slice(0, 30)}" in the catalogue`,
        );
      }
      keys[action as ServerActionName] = plainPath(path, `${at}: cles.${action}`);
    }
    const paths = Object.values(keys);
    if (new Set(paths).size !== paths.length) {
      throw new ServersConfigError("partagee", `${at}: one key per action, never shared`);
    }
    return { name: nom, address: adresse, account: compte, keys };
  });
  return { knownHosts, servers };
}

/** `[serveurs] actif` of securite.toml: anything but `true` is off. */
export function parseServerSwitch(text: string): boolean {
  try {
    const data = parse(text) as Record<string, unknown>;
    const s = data.serveurs;
    return table(s) && s.actif === true;
  } catch {
    return false;
  }
}

/** Fixed options; no command — the key's forced command is the only one the server runs. */
export function sshArgs(server: Server, key: string, knownHosts: string): string[] {
  return [
    "-T",
    "-F",
    "/dev/null",
    "-i",
    key,
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${knownHosts}`,
    "-o",
    "ConnectTimeout=15",
    "-o",
    "ServerAliveInterval=10",
    "-l",
    server.account,
    "--",
    server.address,
  ];
}

/** When Legion's verdict was written (seconds since 1970), or null. */
export function verdictInstant(raw: string): number | null {
  const m = /^instant=(\d{9,11})$/m.exec(raw);
  return m === null ? null : Number(m[1]) * 1000;
}

/** A machine's state in Legion's verdict; MALADE when Legion could not reach it. */
export function hostState(raw: string, host: string): "SAIN" | "SOUFFRANT" | "MALADE" | null {
  if (!NAME.test(host)) return null;
  const m = new RegExp(
    `^${host.replace(/[.-]/g, "\\$&")}\\.etat=(SAIN|SOUFFRANT|MALADE)$`,
    "m",
  ).exec(raw);
  return (m?.[1] as "SAIN" | "SOUFFRANT" | "MALADE" | undefined) ?? null;
}

/** How many the verdict counts for this kind of finding on this machine (services, updates), or null. */
export function motifCount(
  observations: readonly Observation[],
  host: string,
  findingType: string,
): number | null {
  const count = observations.find((o) => o.type === findingType && o.target === host)?.params
    ?.count;
  return count !== undefined && /^\d{1,5}$/.test(count) ? Number(count) : null;
}

/** Does the verdict still show this kind of finding on this machine? */
export const motifPresent = (
  observations: readonly Observation[],
  host: string,
  findingType: string,
): boolean => observations.some((o) => o.type === findingType && o.target === host);
