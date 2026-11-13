/**
 * Purges that really erase (phase 5, C1 — ADR-0009, charter rule 4).
 *
 * The application role may not delete proposals nor journal events: it calls
 * two database functions that run as the owner, erase what is older than the
 * cutoff, and leave in the journal how many and before when — never what.
 * Open proposals are never touched. The database refuses a cutoff more recent
 * than the cadre's retention (032): a purge cannot be asked to erase what is
 * still due, by anyone. The opposition list (T-07) is purged
 * directly: its keys leave `opposition_jours` after the person's last trace.
 */
import type { Sql } from "postgres";

export interface Purges {
  /** Closed proposals closed before the cutoff. Returns how many. */
  proposals(cutoff: Date): Promise<number>;
  /** Journal events older than the cutoff. Returns how many. */
  events(cutoff: Date): Promise<number>;
  /** Opposed keys whose last trace (request or mail met) is older than the cutoff. Returns how many. */
  opposition(cutoff: Date): Promise<number>;
}

/**
 * The database refused a purge: its cutoff is more recent than the floor the
 * database holds (032), or no floor is set. Either way the cadre and the
 * database disagree — `npm run db:migrate` tells the database the cadre's
 * retentions. Named, so the log says what happened without the database's text.
 */
export class PurgeFloorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurgeFloorError";
  }
}

/** The database's own refusals (032) under their name; anything else as it came. */
async function floored<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "PC001") {
      throw new PurgeFloorError(
        `${what}: the cutoff is more recent than the retention the database holds (npm run db:migrate after changing a retention)`,
      );
    }
    if (code === "PC002") {
      throw new PurgeFloorError(`${what}: the database holds no floor (npm run db:migrate)`);
    }
    throw error;
  }
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
        await floored(
          "purge_proposals",
          () => sql<{ n: number }[]>`select purge_proposals(${cutoff}) as n`,
        ),
        "purge_proposals",
      );
    },
    async events(cutoff) {
      return count(
        await floored(
          "purge_events",
          () => sql<{ n: number }[]>`select purge_events(${cutoff}) as n`,
        ),
        "purge_events",
      );
    },
    async opposition(cutoff) {
      // The application role may remove from the list (a withdrawal): no function needed.
      const result = await sql`
        delete from opposed_keys where greatest(since, last_seen) < ${cutoff}`;
      return result.count;
    },
  };
}
