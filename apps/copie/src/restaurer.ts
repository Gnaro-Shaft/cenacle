/**
 * A restore, step by step (ADR-0044, points 7 and 8). Everything that can
 * refuse refuses before anything stops: the file, the tools, the key, the
 * copy judged, the base's columns, the tables' state. Then the writers stop
 * (not in a trial), the four tables are reloaded in one transaction, their
 * purges replayed, and the writers start again — whatever happened. A trial
 * reloads the test base, stops nothing, and compares it with production,
 * table by table, by counts, sums and sequences: never a row shown.
 */
import type { Sql } from "postgres";
import { archiveToSql, checkCopyFile, decrypt, judgeScript } from "./archive.ts";
import { type Container, CopieError } from "./export.ts";
import { type Retentions, replayPurges } from "./purges.ts";
import {
  fingerprints,
  type Mode,
  missingColumns,
  refuseState,
  reload,
  reloadText,
  rowCounts,
} from "./recharge.ts";
import { resumeWriters, type ServiceDeps, stopWriters } from "./services.ts";

export interface RestoreDeps {
  readonly file: string;
  readonly mode: Mode;
  /** My private key, typed: asked once the copy is known to be one. */
  readonly readKey: () => Promise<string>;
  readonly tools: { readonly docker: string | null; readonly age: string | null };
  readonly container: (docker: string) => Container | null;
  /** The base reloaded: the real one, or the test one in a trial. */
  readonly database: string;
  /** In a trial, the base compared with; else null. */
  readonly production: string | null;
  readonly ownerPassword: string;
  readonly connect: (database: string) => Sql;
  /** null in a trial: nothing is stopped. */
  readonly services: ServiceDeps | null;
  readonly retentions: () => Retentions;
  readonly now: () => Date;
  /**
   * From the writers' stop to their start: Ctrl-C, a kill or a closed
   * terminal must not leave them down. Returns what lets go again.
   */
  readonly holdSignals?: () => () => void;
}

export interface RestoreResult {
  readonly rows: ReadonlyMap<string, number>;
  readonly purged: ReadonlyMap<string, number | null>;
  readonly stopped: readonly string[];
  /** Writers that did not start again: to start by hand. */
  readonly notRestarted: readonly string[];
  /** In a trial: each table, the same as production or not. */
  readonly same: ReadonlyMap<string, boolean> | null;
}

async function prepare(deps: RestoreDeps) {
  checkCopyFile(deps.file);
  const { docker, age } = deps.tools;
  if (docker === null) throw new CopieError("docker est introuvable : rien n'est restauré");
  if (age === null) {
    throw new CopieError("age est introuvable (brew install age) : rien n'est restauré");
  }
  const container = deps.container(docker);
  if (container === null) {
    throw new CopieError(
      "aucun conteneur unique ne publie le port de la base, avec une adresse sur son réseau",
    );
  }
  const retentions = deps.retentions();
  const archive = await decrypt(age, await deps.readKey(), deps.file);
  const script = await archiveToSql(docker, container, archive);
  return { docker, container, retentions, script, content: judgeScript(script) };
}

async function compare(sql: Sql, prod: Sql): Promise<Map<string, boolean>> {
  const [mine, theirs] = [await fingerprints(sql), await fingerprints(prod)];
  return new Map(
    [...mine].map(([table, f]) => {
      const p = theirs.get(table);
      const same =
        p !== undefined && p.rows === f.rows && p.sum === f.sum && p.sequence === f.sequence;
      return [table, same];
    }),
  );
}

export async function runRestore(deps: RestoreDeps): Promise<RestoreResult> {
  const { docker, container, retentions, script, content } = await prepare(deps);
  const sql = deps.connect(deps.database);
  try {
    const missing = await missingColumns(sql, content);
    if (missing.length > 0) {
      throw new CopieError(
        `la base n'a pas ${missing.length} colonne(s) de la copie (${missing.join(", ")}) : npm run db:migrate, puis recommence`,
      );
    }
    refuseState(await rowCounts(sql), deps.mode);
    const release = deps.services === null ? () => {} : (deps.holdSignals?.() ?? (() => {}));
    let stopped: string[] = [];
    try {
      stopped = deps.services === null ? [] : await stopWriters(deps.services);
    } catch (error) {
      release();
      throw error;
    }
    let purged: Map<string, number | null>;
    let notRestarted: string[] = [];
    try {
      const target = {
        docker,
        container,
        database: deps.database,
        ownerPassword: deps.ownerPassword,
      };
      await reload(target, reloadText(script, deps.mode));
      try {
        purged = await replayPurges(sql, retentions, deps.now());
      } catch {
        throw new CopieError(
          "la copie est rechargée, mais ses purges n'ont pas été rejouées : les services les feront à leur prochain passage",
        );
      }
    } finally {
      if (deps.services !== null) notRestarted = await resumeWriters(deps.services, stopped);
      release();
    }
    const counts = await rowCounts(sql);
    const rows = new Map([...content.columns.keys()].map((t) => [t, counts.get(t) ?? 0]));
    let same: Map<string, boolean> | null = null;
    if (deps.production !== null) {
      const prod = deps.connect(deps.production);
      try {
        same = await compare(sql, prod);
      } finally {
        await prod.end();
      }
    }
    return { rows, purged, stopped, notRestarted, same };
  } finally {
    await sql.end();
  }
}
