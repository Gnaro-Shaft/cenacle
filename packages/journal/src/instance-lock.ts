/**
 * One instance of a program at a time (ADR-0018): two Iris would run every
 * pass twice and send every alert twice. The lock is a PostgreSQL session
 * advisory lock held on a reserved connection: it falls by itself when the
 * process dies, so a crashed Iris never blocks the next one.
 */
import { createHash } from "node:crypto";
import type { Sql } from "postgres";

export interface InstanceLock {
  /** Gives the lock back (a clean exit; a crash gives it back by itself). */
  release(): Promise<void>;
}

const PROGRAM = /^[a-z][a-z0-9_-]{0,31}$/;

/** A stable 63-bit key per program name, inside the "cenacle" namespace. */
export function instanceLockKey(program: string): bigint {
  if (!PROGRAM.test(program)) throw new Error(`invalid program name ${JSON.stringify(program)}`);
  const digest = createHash("sha256").update(`cenacle.instance.${program}`).digest();
  return digest.readBigInt64BE(0) & 0x7fff_ffff_ffff_ffffn;
}

/**
 * Takes the program's lock, or returns null if another instance holds it.
 * Throws if the database cannot be reached: no lock, no start.
 */
export async function holdSingleInstance(sql: Sql, program: string): Promise<InstanceLock | null> {
  const key = instanceLockKey(program);
  const reserved = await sql.reserve();
  try {
    const [row] = await reserved<{ locked: boolean }[]>`
      select pg_try_advisory_lock(${key.toString()}::bigint) as locked`;
    if (row?.locked !== true) {
      reserved.release();
      return null;
    }
  } catch (error) {
    reserved.release();
    throw error;
  }
  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      try {
        await reserved`select pg_advisory_unlock(${key.toString()}::bigint)`;
      } finally {
        reserved.release();
      }
    },
  };
}
