/**
 * One instance of a program at a time (ADR-0018): two Iris would run every
 * pass twice and send every alert twice. The lock is a PostgreSQL session
 * advisory lock, held on a client of its own with one connection
 * (connectLockAsApp): it falls by itself when the process dies, so a crashed
 * Iris never blocks the next one. A cut of the database drops it too: it is
 * checked and taken again (ADR-0023).
 */
import { createHash } from "node:crypto";
import type { Sql } from "postgres";

export interface InstanceLock {
  /** Gives the lock back (a clean exit; a crash gives it back by itself). */
  release(): Promise<void>;
  /**
   * Checks the lock is still held (ADR-0023): a restart of the database, or a
   * cut connection, drops it without a word. Lost but free: taken again.
   * Taken by another instance meanwhile: "lost". Database away: "unknown".
   */
  check(): Promise<LockCheck>;
  /** Checks every `intervalMs`; the timer never keeps the process alive. */
  watch(on: LockWatchers, intervalMs?: number): void;
}

export type LockCheck = "held" | "retaken" | "lost" | "unknown";

export interface LockWatchers {
  readonly retaken: () => void;
  readonly lost: () => void;
}

export const LOCK_CHECK_MS = 30_000;

const PROGRAM = /^[a-z][a-z0-9_-]{0,31}$/;

/** A stable 63-bit key per program name, inside the "cenacle" namespace. */
export function instanceLockKey(program: string): bigint {
  if (!PROGRAM.test(program)) throw new Error(`invalid program name ${JSON.stringify(program)}`);
  const digest = createHash("sha256").update(`cenacle.instance.${program}`).digest();
  return digest.readBigInt64BE(0) & 0x7fff_ffff_ffff_ffffn;
}

/**
 * Takes the program's lock on `sql` (a one-connection client, connectLockAsApp),
 * or returns null if another instance — or this client already — holds it.
 * Throws if the database cannot be reached: no lock, no start.
 */
export async function holdSingleInstance(sql: Sql, program: string): Promise<InstanceLock | null> {
  const key = instanceLockKey(program).toString();
  // Two connections would check on one session and lock on another.
  if (sql.options.max !== 1 || sql.options.max_lifetime !== null) {
    throw new Error("the instance lock needs a client of its own (connectLockAsApp)");
  }
  // One statement, so one session: whether it already holds the lock, and,
  // if not, whether it can take it. Never re-entrant: a lock taken twice on
  // one session would need two releases.
  const state = async () => {
    const [row] = await sql<{ held: boolean; locked: boolean }[]>`
      with mine as (
        select exists (
          select 1 from pg_locks
          where locktype = 'advisory' and granted and objsubid = 1
            and pid = pg_backend_pid()
            and ((classid::bigint << 32) | objid::bigint) = ${key}::bigint
        ) as held
      )
      select (select held from mine) as held,
        case when (select held from mine) then false
          else pg_try_advisory_lock(${key}::bigint) end as locked`;
    return { held: row?.held === true, locked: row?.locked === true };
  };
  if (!(await state()).locked) return null;

  let released = false;
  let timer: NodeJS.Timeout | undefined;
  let checking = false;

  async function check(): Promise<LockCheck> {
    if (released) return "unknown";
    try {
      const { held, locked } = await state();
      if (held) return "held";
      // A new session (the old one died): taken again if it was free.
      return locked ? "retaken" : "lost";
    } catch {
      // The database is away: nobody can take the lock meanwhile.
      return "unknown";
    }
  }

  return {
    check,
    watch: (on, intervalMs = LOCK_CHECK_MS) => {
      clearInterval(timer);
      timer = setInterval(async () => {
        if (checking) return;
        checking = true;
        try {
          const now = await check();
          if (now === "retaken") on.retaken();
          if (now === "lost") on.lost();
        } finally {
          checking = false;
        }
      }, intervalMs);
      timer.unref();
    },
    release: async () => {
      if (released) return;
      released = true;
      clearInterval(timer);
      try {
        await sql`select pg_advisory_unlock(${key}::bigint)`;
      } catch {
        // The database is away: the lock fell with the session anyway.
      }
    },
  };
}

/**
 * Watches a long-running program's lock (ADR-0023): one line when it is taken
 * again after a cut; when another instance took it meanwhile, this one leaves
 * with 75, as at start — only the holder runs on.
 */
export function watchOrQuit(lock: InstanceLock, who: string): void {
  lock.watch({
    retaken: () => console.log(`🔒 ${who} : verrou d'instance repris après une coupure de la base`),
    lost: () => {
      console.error(
        `🛑 ${who} : un autre exemplaire a pris le verrou pendant une coupure de la base — celui-ci s'arrête.`,
      );
      process.exit(75);
    },
  });
}
