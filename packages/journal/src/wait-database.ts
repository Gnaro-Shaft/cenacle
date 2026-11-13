/**
 * A program started before its database (lot C, 13/11). At the Mac's start,
 * launchd opens the session's programs before Docker has started Postgres:
 * each one crashed on its first query, left a stack in its log, and launchd
 * started it again, in a loop, until the base answered. Now a program waits
 * for an answer: one line said once, retries spaced from 2 s to 30 s, up to
 * 5 minutes; then it quits in one line and launchd tries again later.
 * A refusal that waiting cannot cure (a wrong password, an unknown database)
 * quits at once.
 */
import { errorText } from "@cenacle/core";
import type { Sql } from "postgres";

/** Failures of a base not there yet, or still starting: worth waiting for. */
const NOT_YET: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "ENOTFOUND", // a host name not resolvable yet: the network comes up after the session
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now: the database system is starting up
]);

export const WAIT_MAX_MS = 5 * 60_000;
const FIRST_DELAY_MS = 2000;
const MAX_DELAY_MS = 30_000;

export class DatabaseWaitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseWaitError";
  }
}

/** True when the failure is the base's absence, not a refusal. */
export function notYet(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && NOT_YET.has(code);
}

export interface WaitDeps {
  readonly log: (line: string) => void;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly maxMs?: number;
}

const realDeps: WaitDeps = {
  log: (line) => console.error(line),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

/**
 * Resolves once `select 1` answers; throws DatabaseWaitError after the
 * waiting time, or the first error that waiting cannot cure.
 */
export async function untilDatabaseAnswers(
  query: () => Promise<unknown>,
  deps: WaitDeps = realDeps,
): Promise<void> {
  const started = deps.now();
  const maxMs = deps.maxMs ?? WAIT_MAX_MS;
  let delay = FIRST_DELAY_MS;
  let said = false;
  for (;;) {
    try {
      await query();
      if (said) deps.log("✔ La base répond : le programme démarre.");
      return;
    } catch (error) {
      if (!notYet(error)) throw error;
      if (deps.now() - started >= maxMs) {
        throw new DatabaseWaitError(
          `the database did not answer in ${Math.round(maxMs / 60_000)} min (${errorText(error)})`,
        );
      }
      if (!said) {
        deps.log(
          `⏳ La base ne répond pas encore (${errorText(error)}) : j'attends, 5 min au plus.`,
        );
        said = true;
      }
      // Never past the bound: the last wait is cut to what is left of it.
      await deps.sleep(Math.min(delay, maxMs - (deps.now() - started)));
      delay = Math.min(delay * 2, MAX_DELAY_MS);
    }
  }
}

/**
 * For a program's entry point: the connection, once the base answers; or
 * one line and exit 1 (no stack: the rule of connectOrQuit).
 */
export async function waitForDatabase(sql: Sql, deps: WaitDeps = realDeps): Promise<Sql> {
  try {
    await untilDatabaseAnswers(() => sql`select 1`, deps);
    return sql;
  } catch (error) {
    deps.log(`🛑 ${errorText(error, [DatabaseWaitError])}`);
    process.exit(1);
  }
}
