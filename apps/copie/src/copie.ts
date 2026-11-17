/**
 * One night's copy (ADR-0044): every check first, then export and encrypt
 * into a folder of the Mac's own temporary space (readable by me only), push,
 * and remove — whatever happened. Anything missing or wrong: nothing leaves,
 * and one line says why, naming no path, no value.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type CopieConfig, CopieConfigError, parseCopieConfig } from "./config.ts";
import { type Container, CopieError, type DumpOptions } from "./export.ts";
import { type Push, rsyncArgs } from "./pousser.ts";

export interface CopieDeps {
  /** copie.local.toml's text, or null when absent. */
  readonly readConfig: () => string | null;
  readonly pushKey: string;
  readonly keyOk: (path: string) => boolean;
  readonly knownHostsOk: (path: string) => boolean;
  readonly tools: {
    readonly docker: string | null;
    readonly age: string | null;
    readonly rsync: string | null;
  };
  readonly container: (docker: string) => Container | null;
  readonly password: string;
  readonly database: string;
  readonly tmp: string;
  readonly dump: (o: DumpOptions) => Promise<number>;
  readonly push: Push;
  readonly now: () => Date;
}

/** The night's own folders in the temporary space: a prefix no test or other program uses. */
export const WORK_PREFIX = "cenacle-copie-nuit-";

/**
 * A copy cut short (the Mac off, the process killed) leaves its folder: the
 * next one sweeps it. Only the copy's own (the instance lock: no other runs).
 */
function sweep(tmp: string): void {
  for (const entry of readdirSync(tmp)) {
    if (entry.startsWith(WORK_PREFIX)) rmSync(join(tmp, entry), { recursive: true, force: true });
  }
}

export interface CopieResult {
  readonly name: string;
  readonly bytes: number;
}

/** The copy's file name: the day (UTC) and 8 bytes drawn at random. */
export function copyName(now: Date, random = randomBytes(8)): string {
  return `cenacle-${now.toISOString().slice(0, 10)}-${random.toString("hex")}.age`;
}

function configOf(deps: CopieDeps): CopieConfig {
  const text = deps.readConfig();
  if (text === null) throw new CopieError("copie.local.toml est absent : aucune copie");
  try {
    return parseCopieConfig(text);
  } catch (error) {
    if (error instanceof CopieConfigError) {
      throw new CopieError(`copie.local.toml : ${error.message} — aucune copie`);
    }
    throw error;
  }
}

export async function runCopie(deps: CopieDeps): Promise<CopieResult> {
  const config = configOf(deps);
  if (!deps.keyOk(deps.pushKey)) {
    throw new CopieError(
      "la clé de poussée manque, ou d'autres que moi peuvent la lire : aucune copie",
    );
  }
  if (!deps.knownHostsOk(config.knownHosts)) {
    throw new CopieError("le known_hosts déclaré est introuvable : aucune copie");
  }
  const { docker, age, rsync } = deps.tools;
  if (docker === null) throw new CopieError("docker est introuvable : aucune copie");
  if (age === null) throw new CopieError("age est introuvable (brew install age) : aucune copie");
  if (rsync === null) {
    throw new CopieError("rsync 3 est introuvable (brew install rsync) : aucune copie");
  }
  const container = deps.container(docker);
  if (container === null) {
    throw new CopieError(
      "aucun conteneur unique ne publie le port de la base, avec une adresse sur son réseau : aucune copie",
    );
  }
  sweep(deps.tmp);
  const dir = mkdtempSync(join(deps.tmp, WORK_PREFIX));
  try {
    const name = copyName(deps.now());
    const out = join(dir, name);
    const bytes = await deps.dump({
      docker,
      age,
      container,
      database: deps.database,
      password: deps.password,
      recipient: config.recipient,
      out,
    });
    const code = await deps.push(rsync, rsyncArgs(config, deps.pushKey, out));
    if (code !== 0) {
      throw new CopieError(`la poussée vers le serveur de sauvegarde a échoué (code ${code})`);
    }
    return { name, bytes };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
