/**
 * The machines whose bulletin the Parc tab reads (ADR-0039): parc.local.toml,
 * git-ignored. A file of its own, apart from serveurs.local.toml: the operator
 * stays the only reader of the action keys (ADR-0027), the page's server
 * only ever sees the read-only keys. As strict as the operator's file: an
 * unknown key, a doubtful path or a duplicate refuses the whole file.
 */
import { isAbsolute, normalize } from "node:path";
import { parse } from "smol-toml";
import { ACCOUNT, ADDRESS, NAME, type Server } from "./servers.ts";

export const PARK_FILE = "parc.local.toml";
const MAX_MACHINES = 20;

export interface ParkMachine {
  /** As the page shows it (Legion's name, while Legion runs). */
  readonly name: string;
  readonly address: string;
  readonly account: string;
  /** The read-only key, locked on cenacle-bulletin on the server. */
  readonly key: string;
}

export interface ParkConfig {
  readonly knownHosts: string;
  readonly machines: readonly ParkMachine[];
}

export class ParkConfigError extends Error {
  constructor(message: string) {
    super(`${PARK_FILE}: ${message}`);
    this.name = "ParkConfigError";
  }
}

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
    throw new ParkConfigError(`${what} must be a plain absolute path`);
  }
  return p;
}

const table = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function parseParkMachines(text: string): ParkConfig {
  let data: Record<string, unknown>;
  try {
    data = parse(text) as Record<string, unknown>;
  } catch {
    throw new ParkConfigError("not valid TOML");
  }
  if (Object.keys(data).some((k) => k !== "known_hosts" && k !== "machine")) {
    throw new ParkConfigError("only known_hosts and [[machine]] are expected");
  }
  const knownHosts = plainPath(data.known_hosts, "known_hosts");
  const list = data.machine ?? [];
  if (!Array.isArray(list)) throw new ParkConfigError("machine must be [[machine]] blocks");
  if (list.length > MAX_MACHINES) throw new ParkConfigError(`${MAX_MACHINES} machines at most`);
  const names = new Set<string>();
  const keys = new Set<string>();
  const machines = list.map((raw, i): ParkMachine => {
    const at = `machine n°${i + 1}`;
    if (!table(raw)) throw new ParkConfigError(`${at} is not a table`);
    if (Object.keys(raw).some((k) => !["nom", "adresse", "compte", "cle"].includes(k))) {
      throw new ParkConfigError(`${at}: unknown key`);
    }
    const { nom, adresse, compte, cle } = raw;
    if (typeof nom !== "string" || !NAME.test(nom)) throw new ParkConfigError(`${at}: nom`);
    if (names.has(nom)) throw new ParkConfigError(`${at}: nom ${nom} twice`);
    names.add(nom);
    if (typeof adresse !== "string" || !ADDRESS.test(adresse)) {
      throw new ParkConfigError(`${at}: adresse must be a host name`);
    }
    if (typeof compte !== "string" || !ACCOUNT.test(compte) || compte === "root") {
      throw new ParkConfigError(`${at}: compte must be a plain account, never root`);
    }
    const key = plainPath(cle, `${at}: cle`);
    if (keys.has(key)) throw new ParkConfigError(`${at}: one key per machine, never shared`);
    keys.add(key);
    return { name: nom, address: adresse, account: compte, key };
  });
  return { knownHosts, machines };
}

/** The machine as servers.ts's sshArgs takes it: no action key, ever. */
export const asServer = (m: ParkMachine): Server => ({
  name: m.name,
  address: m.address,
  account: m.account,
  keys: {},
});
