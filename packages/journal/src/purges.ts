/**
 * Purges that really erase (phase 5, C1 — ADR-0009, charter rule 4).
 *
 * The application role may not delete proposals nor journal events: it calls
 * two database functions that run as the owner, erase what is older than the
 * cutoff, and leave in the journal how many and before when — never what.
 * Open proposals are never touched.
 */
import type { Sql } from "postgres";

export interface Purges {
  /** Closed proposals closed before the cutoff. Returns how many. */
  proposals(cutoff: Date): Promise<number>;
  /** Journal events older than the cutoff. Returns how many. */
  events(cutoff: Date): Promise<number>;
}

function count(rows: { n: number }[], what: string): number {
  const [row] = rows;
  // No silent zero: a purge that says nothing has not been done.
  if (row === undefined || typeof row.n !== "number") {
    throw new Error(`${what}: the database returned no count`);
  }
  return row.n;
}

export function createPurges(sql: Sql): Purges {
  return {
    async proposals(cutoff) {
      return count(
        await sql<{ n: number }[]>`select purge_proposals(${cutoff}) as n`,
        "purge_proposals",
      );
    },
    async events(cutoff) {
      return count(await sql<{ n: number }[]>`select purge_events(${cutoff}) as n`, "purge_events");
    },
  };
}
