/**
 * The floors of the purges (032, charter rule 4): the retentions of the cadre,
 * told to the database so that it refuses a purge more recent than them —
 * whoever asks, whatever the code believes.
 *
 * Runs as the database owner, like the migrations: `npm run db:migrate` sets
 * them after applying the schema, and the tests set theirs. The programs
 * never do: the application role can neither read nor change a floor.
 * Changing a retention in the cadre therefore needs `npm run db:migrate`.
 */
import { UsageError } from "@cenacle/core";
import postgres from "postgres";
import { ownerUrlFromEnv } from "./migrate.ts";

export interface PurgeFloors {
  /** `journal_jours`: journal events. */
  readonly journalJours: number;
  /** `propositions_jours`: closed proposals. */
  readonly propositionsJours: number;
}

const MAX_DAYS = 730;

function days(value: number, key: string): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_DAYS) {
    throw new UsageError(`purge floor ${key}: a whole number of days from 1 to ${MAX_DAYS}`);
  }
  return value;
}

/** Writes both floors, or neither. The owner's password comes from .env.owner. */
export async function setPurgeFloors(floors: PurgeFloors, database = "cenacle"): Promise<void> {
  const rows = [
    { cle: "journal_jours", jours: days(floors.journalJours, "journal_jours") },
    { cle: "propositions_jours", jours: days(floors.propositionsJours, "propositions_jours") },
  ];
  const sql = postgres(ownerUrlFromEnv(database), { infer: true, max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      for (const row of rows) {
        await tx`
          insert into purge_planchers (cle, jours) values (${row.cle}, ${row.jours})
          on conflict (cle) do update set jours = excluded.jours, pose_le = clock_timestamp()
          where purge_planchers.jours <> excluded.jours`;
      }
    });
  } finally {
    await sql.end();
  }
}
