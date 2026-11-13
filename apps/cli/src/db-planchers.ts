/**
 * Tells the database the retentions of the cadre, as the floors of its purges
 * (032, charter rule 4): past this, `purge_events` and `purge_proposals`
 * refuse a cutoff more recent than `journal_jours` and `propositions_jours`.
 *
 * Runs as the database owner, right after the migrations — it is the second
 * half of `npm run db:migrate`. Reads the cadre the programs read
 * (cadre.local.toml when it exists, cadre.toml otherwise). No mail, no model.
 * Usage: npm run db:migrate
 * (alone, on another database of the cluster: node … db-planchers.ts cenacle_test)
 */
import { errorText, UsageError } from "@cenacle/core";
import { setPurgeFloors } from "@cenacle/journal";
import { CadreError, loadCadre, TraitementError } from "@cenacle/mail";

try {
  const database = process.argv[2] ?? "cenacle";
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(database) || process.argv.length > 3) {
    throw new UsageError("usage: db-planchers.ts [database]");
  }
  const { conservation } = loadCadre();
  await setPurgeFloors(
    {
      journalJours: conservation.journalJours,
      propositionsJours: conservation.propositionsJours,
    },
    database,
  );
  console.log(
    `Purge floors set: journal ${conservation.journalJours} days, proposals ${conservation.propositionsJours} days`,
  );
} catch (error) {
  // Our own messages only: a database's could quote a connection string.
  console.error(`🛑 ${errorText(error, [UsageError, CadreError, TraitementError])}`);
  process.exitCode = 1;
}
