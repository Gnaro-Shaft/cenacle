/**
 * Applies the schema and sets up the application role.
 *
 * Runs as the database owner. The application itself never connects as
 * the owner: it uses `cenacle_app`, which may only INSERT and SELECT events
 * (and read, add, categorize and expire mail items). The executor alone uses
 * `cenacle_executor`, the only role allowed to claim and close a sending
 * (ADR-0013); its password lives in .env.executor, loaded by it alone. The
 * nightly copy alone uses `cenacle_copie`, which reads four tables and their
 * sequences, and nothing else (ADR-0044); its password lives in .env.copie.
 *
 * Usage: node --env-file=.env packages/journal/src/migrate.ts
 * (self-contained on purpose: no relative imports, so Node can run it directly)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "@cenacle/core";
import postgres from "postgres";

export const APP_ROLE = "cenacle_app";
export const EXECUTOR_ROLE = "cenacle_executor";
export const EXECUTOR_PASSWORD_VAR = "CENACLE_DB_EXECUTOR_PASSWORD";
export const COPIE_ROLE = "cenacle_copie";
export const COPIE_PASSWORD_VAR = "CENACLE_DB_COPIE_PASSWORD";
/**
 * What the nightly copy reads (ADR-0044): what can be read back from nowhere
 * else. Never prospection_mails_lus (its ids only mean something with the
 * mail memory, which is not copied), nor anything else of the base.
 */
export const COPIE_TABLES = [
  "rappels",
  "prospection_cartes",
  "veille_articles",
  "securite_constats",
] as const;
const SQL_DIR = join(import.meta.dirname, "..", "sql");
const PASSWORD_RULE = /^[A-Za-z0-9_-]{16,128}$/;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new UsageError(`Missing environment variable ${name} (see .env.example)`);
  }
  return value;
}

/** Creates a login role, or resets its password. */
async function loginRole(
  sql: postgres.TransactionSql,
  role: string,
  password: string,
  what: string,
) {
  // The password is interpolated into DDL (Postgres does not accept bind
  // parameters there), so it must match a strict allowlist — never escape.
  if (!PASSWORD_RULE.test(password))
    throw new UsageError(`${what} must be 16-128 chars of [A-Za-z0-9_-]`);
  const [exists] = await sql`select 1 from pg_roles where rolname = ${role}`;
  // ADR-0038: the owner is no superuser, and a non-superuser may not even
  // write NOSUPERUSER in an ALTER ROLE. So the attributes are set once, at
  // creation, and afterwards only read back (lockedDown) — never rewritten.
  await sql.unsafe(
    exists === undefined
      ? `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`
      : `ALTER ROLE ${role} LOGIN PASSWORD '${password}'`,
  );
  await lockedDown(sql, role);
}

/**
 * Refuses to go on if a program's role holds more than it should: an
 * attribute, or membership of any other role (whose rights it would borrow).
 * Throwing undoes the whole migration (one transaction).
 */
export async function lockedDown(sql: postgres.Sql | postgres.TransactionSql, role: string) {
  const [row] = await sql<
    {
      super: boolean;
      createrole: boolean;
      createdb: boolean;
      replication: boolean;
      bypassrls: boolean;
    }[]
  >`select rolsuper as super, rolcreaterole as createrole, rolcreatedb as createdb,
           rolreplication as replication, rolbypassrls as bypassrls
      from pg_roles where rolname = ${role}`;
  if (row === undefined) throw new Error(`Role ${role} is missing`);
  const gained = Object.entries(row)
    .filter(([, held]) => held)
    .map(([right]) => right.toUpperCase());
  const memberOf = await sql<{ name: string }[]>`
    select g.rolname as name from pg_auth_members m
      join pg_roles g on g.oid = m.roleid
      join pg_roles r on r.oid = m.member
     where r.rolname = ${role} order by 1`;
  gained.push(...memberOf.map((m) => `member of ${m.name}`));
  if (gained.length > 0) {
    throw new Error(
      `${role} holds rights it must never have (${gained.join(", ")}): remove them as cenacle_admin, then migrate again (ADR-0038)`,
    );
  }
}

/** Whether the role the migrations run as is a superuser — it must not be (ADR-0038). */
export async function runsAsSuperuser(url: string): Promise<boolean> {
  const sql = postgres(url, { infer: true, max: 1, onnotice: () => {} });
  try {
    const [row] = await sql<{ super: boolean }[]>`
      select rolsuper as super from pg_roles where rolname = current_user`;
    return row?.super === true;
  } finally {
    await sql.end();
  }
}

/**
 * The copy's role (ADR-0044): SELECT on the four tables and on the sequences
 * they own (their identity values leave with them), and nothing else. Every
 * right on the schema is taken back first, so a table leaving the list
 * leaves the role's reach at the next migration.
 */
async function copieRole(tx: postgres.TransactionSql, database: string, password: string) {
  await loginRole(tx, COPIE_ROLE, password, COPIE_PASSWORD_VAR);
  await tx.unsafe(`GRANT CONNECT ON DATABASE "${database}" TO ${COPIE_ROLE}`);
  await tx.unsafe(`GRANT USAGE ON SCHEMA public TO ${COPIE_ROLE}`);
  await tx.unsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${COPIE_ROLE}`);
  await tx.unsafe(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${COPIE_ROLE}`);
  await tx.unsafe(`GRANT SELECT ON ${COPIE_TABLES.join(", ")} TO ${COPIE_ROLE}`);
  const owned = await tx<{ seq: string }[]>`
    select s.oid::regclass::text as seq
      from pg_class s
      join pg_depend d on d.classid = 'pg_class'::regclass and d.objid = s.oid
                      and d.refclassid = 'pg_class'::regclass and d.deptype in ('a', 'i')
      join pg_class t on t.oid = d.refobjid
     where s.relkind = 'S' and t.relnamespace = 'public'::regnamespace
       and t.relname = any(${[...COPIE_TABLES]})
     order by 1`;
  if (owned.length !== COPIE_TABLES.length) {
    throw new Error(`${COPIE_ROLE}: expected one sequence per copied table, found ${owned.length}`);
  }
  await tx.unsafe(
    `GRANT SELECT ON SEQUENCE ${owned.map((o) => o.seq).join(", ")} TO ${COPIE_ROLE}`,
  );
}

export interface MigrateOptions {
  ownerUrl: string;
  appPassword: string;
  executorPassword: string;
  copiePassword: string;
}

export async function migrate({
  ownerUrl,
  appPassword,
  executorPassword,
  copiePassword,
}: MigrateOptions): Promise<string[]> {
  const passwords = [
    [appPassword, "CENACLE_DB_APP_PASSWORD"],
    [executorPassword, EXECUTOR_PASSWORD_VAR],
    [copiePassword, COPIE_PASSWORD_VAR],
  ] as const;
  for (const [password, name] of passwords) {
    if (!PASSWORD_RULE.test(password))
      throw new UsageError(`${name} must be 16-128 chars of [A-Za-z0-9_-]`);
  }
  // One password per role: whoever holds one never holds another's rights.
  for (const [i, [password, name]] of passwords.entries()) {
    const twin = passwords.slice(0, i).find(([other]) => other === password);
    if (twin !== undefined) throw new UsageError(`${name} must differ from ${twin[1]}`);
  }
  const sql = postgres(ownerUrl, { infer: true, max: 1, onnotice: () => {} });
  const applied: string[] = [];
  try {
    // One transaction (lot F2, 13/11): the files drop and recreate triggers
    // (the journal's append-only one among them) and every grant is revoked
    // then given again. Out of a transaction, a running program saw, for an
    // instant, a table without its trigger or a role without its rights.
    // Now it sees the old state or the new one, never one in between.
    await sql.begin(async (tx) => {
      // Never wait long behind a running program's lock (F2 review): past 5 s
      // the whole migration is undone and says so — run it again; nothing half done.
      await tx.unsafe("set local lock_timeout = '5s'");
      for (const file of readdirSync(SQL_DIR)
        .filter((f) => f.endsWith(".sql"))
        .sort()) {
        await tx.unsafe(readFileSync(join(SQL_DIR, file), "utf8"));
        applied.push(file);
      }
      const [db] = await tx<{ name: string }[]>`select current_database() as name`;
      if (db === undefined) throw new Error("Could not read the current database name");
      await loginRole(tx, APP_ROLE, appPassword, "CENACLE_DB_APP_PASSWORD");
      await tx.unsafe(`GRANT CONNECT ON DATABASE "${db.name}" TO ${APP_ROLE}`);
      await tx.unsafe(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
      await tx.unsafe(`REVOKE ALL ON events FROM ${APP_ROLE}`);
      await tx.unsafe(`GRANT INSERT, SELECT ON events TO ${APP_ROLE}`);
      // Mail items change (a category is set once) and expire (retention), but
      // the app still cannot alter the table's structure.
      await tx.unsafe(`REVOKE ALL ON mail_items FROM ${APP_ROLE}`);
      await tx.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON mail_items TO ${APP_ROLE}`);
      // Where each remembered mail is, and how far each folder was read (ADR-0016).
      await tx.unsafe(`REVOKE ALL ON mail_folders, mail_locations FROM ${APP_ROLE}`);
      await tx.unsafe(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON mail_folders, mail_locations TO ${APP_ROLE}`,
      );
      // Proposals are never deleted (their history matters); only their text is wiped.
      await tx.unsafe(`REVOKE ALL ON proposals FROM ${APP_ROLE}`);
      await tx.unsafe(`GRANT SELECT, INSERT, UPDATE ON proposals TO ${APP_ROLE}`);
      // Purges that really erase (C1): through these two functions only, never directly.
      await tx.unsafe(`GRANT EXECUTE ON FUNCTION purge_proposals(TIMESTAMPTZ) TO ${APP_ROLE}`);
      await tx.unsafe(`GRANT EXECUTE ON FUNCTION purge_events(TIMESTAMPTZ) TO ${APP_ROLE}`);
      // The floors of those purges (032): the owner's alone — not even read.
      await tx.unsafe(`REVOKE ALL ON purge_planchers FROM ${APP_ROLE}`);
      // People's rights (C3): the opposition list, and erasing a person's proposals.
      await tx.unsafe(`REVOKE ALL ON opposed_keys FROM ${APP_ROLE}`);
      await tx.unsafe(`GRANT SELECT, INSERT, DELETE ON opposed_keys TO ${APP_ROLE}`);
      // Only the last trace changes; the key and the date of the request never do.
      await tx.unsafe(`GRANT UPDATE (last_seen) ON opposed_keys TO ${APP_ROLE}`);
      await tx.unsafe(
        `GRANT EXECUTE ON FUNCTION erase_proposals_for(TEXT, BIGINT[]) TO ${APP_ROLE}`,
      );
      // The veille's archive (ADR-0024): written once, read, purged — never changed.
      await tx.unsafe(`REVOKE ALL ON veille_articles FROM ${APP_ROLE}`);
      await tx.unsafe(`GRANT SELECT, INSERT, DELETE ON veille_articles TO ${APP_ROLE}`);
      // The prospection agent's cards (ADR-0032): added, read, purged — never changed by it.
      await tx.unsafe(`REVOKE ALL ON prospection_cartes FROM ${APP_ROLE}`);
      await tx.unsafe(`GRANT SELECT, INSERT, DELETE ON prospection_cartes TO ${APP_ROLE}`);
      // My moves, from the page's server: the column, its decider and reason, the date — nothing else.
      await tx.unsafe(
        `GRANT UPDATE (board_column, decided_by, reason, moved_at) ON prospection_cartes TO ${APP_ROLE}`,
      );
      // The alerts it read: marked once, erased with the mail (trigger of 027).
      await tx.unsafe(`REVOKE ALL ON prospection_mails_lus FROM ${APP_ROLE}`);
      await tx.unsafe(`GRANT SELECT, INSERT, DELETE ON prospection_mails_lus TO ${APP_ROLE}`);
      // The security agent's findings (ADR-0025): followed, closed, purged.
      await tx.unsafe(`REVOKE ALL ON securite_constats FROM ${APP_ROLE}`);
      await tx.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON securite_constats TO ${APP_ROLE}`);
      await tx.unsafe(`REVOKE ALL ON securite_raisons FROM ${APP_ROLE}`);
      await tx.unsafe(`GRANT SELECT, INSERT, DELETE ON securite_raisons TO ${APP_ROLE}`);
      // Actions on the servers (ADR-0027): requested, confirmed, run, verified, purged.
      await tx.unsafe(`REVOKE ALL ON serveur_actions FROM ${APP_ROLE}`);
      await tx.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON serveur_actions TO ${APP_ROLE}`);
      // The maintenance plans (ADR-0035, J7d): proposed, confirmed, chained, purged.
      await tx.unsafe(`REVOKE ALL ON maintenance_plans FROM ${APP_ROLE}`);
      await tx.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON maintenance_plans TO ${APP_ROLE}`);
      await tx.unsafe(`REVOKE ALL ON maintenance_etapes FROM ${APP_ROLE}`);
      await tx.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON maintenance_etapes TO ${APP_ROLE}`);
      // The reminders (ADR-0041): set, read, erased; only the instant it rang ever changes.
      await tx.unsafe(`REVOKE ALL ON rappels FROM ${APP_ROLE}`);
      await tx.unsafe(`GRANT SELECT, INSERT, DELETE ON rappels TO ${APP_ROLE}`);
      await tx.unsafe(`GRANT UPDATE (sonne_le) ON rappels TO ${APP_ROLE}`);
      // The liaison with the house (ADR-0048): its life cycle is the table's
      // (triggers of 038), an open demand is never deleted; the last reading of `etat`.
      await tx.unsafe(`REVOKE ALL ON liaison_demandes, liaison_etats FROM ${APP_ROLE}`);
      await tx.unsafe(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON liaison_demandes, liaison_etats TO ${APP_ROLE}`,
      );
      // The mails the drafting program read (ADR-0049): marked once, erased with the mail.
      await tx.unsafe(`REVOKE ALL ON liaison_mails_lus FROM ${APP_ROLE}`);
      await tx.unsafe(`GRANT SELECT, INSERT, DELETE ON liaison_mails_lus TO ${APP_ROLE}`);
      // The executor reads what Iris remembers, journals, and moves proposals
      // (claim, sent, failed — refused to every other role by the database).
      await loginRole(tx, EXECUTOR_ROLE, executorPassword, EXECUTOR_PASSWORD_VAR);
      await tx.unsafe(`GRANT CONNECT ON DATABASE "${db.name}" TO ${EXECUTOR_ROLE}`);
      await tx.unsafe(`GRANT USAGE ON SCHEMA public TO ${EXECUTOR_ROLE}`);
      await tx.unsafe(
        `REVOKE ALL ON events, mail_items, proposals, mail_folders, mail_locations FROM ${EXECUTOR_ROLE}`,
      );
      await tx.unsafe(`GRANT INSERT, SELECT ON events TO ${EXECUTOR_ROLE}`);
      await tx.unsafe(`GRANT SELECT ON mail_items, mail_locations TO ${EXECUTOR_ROLE}`);
      await tx.unsafe(`GRANT SELECT, UPDATE ON proposals TO ${EXECUTOR_ROLE}`);
      await copieRole(tx, db.name, copiePassword);
    });
  } finally {
    await sql.end();
  }
  return applied;
}

/** The owner's connection: migrations and tests only (.env.owner, S1). */
export function ownerUrlFromEnv(database: string): string {
  const host = process.env.CENACLE_DB_HOST ?? "127.0.0.1";
  const port = process.env.CENACLE_DB_PORT ?? "55432";
  const password = encodeURIComponent(requireEnv("CENACLE_DB_OWNER_PASSWORD"));
  return `postgres://cenacle_owner:${password}@${host}:${port}/${database}`;
}

/** The executor's connection: its password is in .env.executor, loaded by it alone. */
export function executorUrlFromEnv(database: string): string {
  const host = process.env.CENACLE_DB_HOST ?? "127.0.0.1";
  const port = process.env.CENACLE_DB_PORT ?? "55432";
  const password = encodeURIComponent(requireEnv(EXECUTOR_PASSWORD_VAR));
  return `postgres://${EXECUTOR_ROLE}:${password}@${host}:${port}/${database}`;
}

/**
 * The application's connection. Never asks for the owner's password: the
 * programs must run without it (S1) — only the migrations and the tests hold it.
 */
export function appUrlFromEnv(database: string, env: NodeJS.ProcessEnv = process.env): string {
  const host = env.CENACLE_DB_HOST ?? "127.0.0.1";
  const port = env.CENACLE_DB_PORT ?? "55432";
  const raw = env.CENACLE_DB_APP_PASSWORD ?? "";
  if (raw === "") {
    throw new UsageError("Missing environment variable CENACLE_DB_APP_PASSWORD (see .env.example)");
  }
  return `postgres://${APP_ROLE}:${encodeURIComponent(raw)}@${host}:${port}/${database}`;
}

if (import.meta.main) {
  const applied = await migrate({
    ownerUrl: ownerUrlFromEnv("cenacle"),
    appPassword: requireEnv("CENACLE_DB_APP_PASSWORD"),
    executorPassword: requireEnv(EXECUTOR_PASSWORD_VAR),
    copiePassword: requireEnv(COPIE_PASSWORD_VAR),
  });
  console.log(`Migrations applied: ${applied.join(", ")}`);
  if (await runsAsSuperuser(ownerUrlFromEnv("cenacle"))) {
    console.log(
      "⚠ Le propriétaire de la base est encore super-utilisateur : npm run db:bascule (ADR-0038).",
    );
  }
}
