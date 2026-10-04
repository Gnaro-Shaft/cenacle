/**
 * Applies the schema and sets up the application role.
 *
 * Runs as the database owner. The application itself never connects as
 * the owner: it uses `cenacle_app`, which may only INSERT and SELECT events
 * (and read, add, categorize and expire mail items). The executor alone uses
 * `cenacle_executor`, the only role allowed to claim and close a sending
 * (ADR-0013); its password lives in .env.executor, loaded by it alone.
 *
 * Usage: node --env-file=.env packages/journal/src/migrate.ts
 * (self-contained on purpose: no relative imports, so Node can run it directly)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

export const APP_ROLE = "cenacle_app";
export const EXECUTOR_ROLE = "cenacle_executor";
export const EXECUTOR_PASSWORD_VAR = "CENACLE_DB_EXECUTOR_PASSWORD";
const SQL_DIR = join(import.meta.dirname, "..", "sql");
const PASSWORD_RULE = /^[A-Za-z0-9_-]{16,128}$/;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing environment variable ${name} (see .env.example)`);
  }
  return value;
}

/** Creates a login role, or resets its password. */
async function loginRole(sql: postgres.Sql, role: string, password: string, what: string) {
  // The password is interpolated into DDL (Postgres does not accept bind
  // parameters there), so it must match a strict allowlist — never escape.
  if (!PASSWORD_RULE.test(password))
    throw new Error(`${what} must be 16-128 chars of [A-Za-z0-9_-]`);
  const [exists] = await sql`select 1 from pg_roles where rolname = ${role}`;
  const verb = exists === undefined ? "CREATE" : "ALTER";
  await sql.unsafe(
    `${verb} ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}'`,
  );
}

export interface MigrateOptions {
  ownerUrl: string;
  appPassword: string;
  executorPassword: string;
}

export async function migrate({
  ownerUrl,
  appPassword,
  executorPassword,
}: MigrateOptions): Promise<string[]> {
  for (const [password, name] of [
    [appPassword, "CENACLE_DB_APP_PASSWORD"],
    [executorPassword, EXECUTOR_PASSWORD_VAR],
  ] as const) {
    if (!PASSWORD_RULE.test(password))
      throw new Error(`${name} must be 16-128 chars of [A-Za-z0-9_-]`);
  }
  if (appPassword === executorPassword) {
    throw new Error(`${EXECUTOR_PASSWORD_VAR} must differ from CENACLE_DB_APP_PASSWORD`);
  }
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  const applied: string[] = [];
  try {
    for (const file of readdirSync(SQL_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      await sql.unsafe(readFileSync(join(SQL_DIR, file), "utf8"));
      applied.push(file);
    }
    const [db] = await sql<{ name: string }[]>`select current_database() as name`;
    if (db === undefined) throw new Error("Could not read the current database name");
    await loginRole(sql, APP_ROLE, appPassword, "CENACLE_DB_APP_PASSWORD");
    await sql.unsafe(`GRANT CONNECT ON DATABASE "${db.name}" TO ${APP_ROLE}`);
    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
    await sql.unsafe(`REVOKE ALL ON events FROM ${APP_ROLE}`);
    await sql.unsafe(`GRANT INSERT, SELECT ON events TO ${APP_ROLE}`);
    // Mail items change (a category is set once) and expire (retention), but
    // the app still cannot alter the table's structure.
    await sql.unsafe(`REVOKE ALL ON mail_items FROM ${APP_ROLE}`);
    await sql.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON mail_items TO ${APP_ROLE}`);
    // Proposals are never deleted (their history matters); only their text is wiped.
    await sql.unsafe(`REVOKE ALL ON proposals FROM ${APP_ROLE}`);
    await sql.unsafe(`GRANT SELECT, INSERT, UPDATE ON proposals TO ${APP_ROLE}`);
    // Purges that really erase (C1): through these two functions only, never directly.
    await sql.unsafe(`GRANT EXECUTE ON FUNCTION purge_proposals(TIMESTAMPTZ) TO ${APP_ROLE}`);
    await sql.unsafe(`GRANT EXECUTE ON FUNCTION purge_events(TIMESTAMPTZ) TO ${APP_ROLE}`);
    // People's rights (C3): the opposition list, and erasing a person's proposals.
    await sql.unsafe(`REVOKE ALL ON opposed_keys FROM ${APP_ROLE}`);
    await sql.unsafe(`GRANT SELECT, INSERT, DELETE ON opposed_keys TO ${APP_ROLE}`);
    await sql.unsafe(
      `GRANT EXECUTE ON FUNCTION erase_proposals_for(TEXT, BIGINT[]) TO ${APP_ROLE}`,
    );
    // The executor reads what Iris remembers, journals, and moves proposals
    // (claim, sent, failed — refused to every other role by the database).
    await loginRole(sql, EXECUTOR_ROLE, executorPassword, EXECUTOR_PASSWORD_VAR);
    await sql.unsafe(`GRANT CONNECT ON DATABASE "${db.name}" TO ${EXECUTOR_ROLE}`);
    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${EXECUTOR_ROLE}`);
    await sql.unsafe(`REVOKE ALL ON events, mail_items, proposals FROM ${EXECUTOR_ROLE}`);
    await sql.unsafe(`GRANT INSERT, SELECT ON events TO ${EXECUTOR_ROLE}`);
    await sql.unsafe(`GRANT SELECT ON mail_items TO ${EXECUTOR_ROLE}`);
    await sql.unsafe(`GRANT SELECT, UPDATE ON proposals TO ${EXECUTOR_ROLE}`);
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
    throw new Error("Missing environment variable CENACLE_DB_APP_PASSWORD (see .env.example)");
  }
  return `postgres://${APP_ROLE}:${encodeURIComponent(raw)}@${host}:${port}/${database}`;
}

if (import.meta.main) {
  const applied = await migrate({
    ownerUrl: ownerUrlFromEnv("cenacle"),
    appPassword: requireEnv("CENACLE_DB_APP_PASSWORD"),
    executorPassword: requireEnv(EXECUTOR_PASSWORD_VAR),
  });
  console.log(`Migrations applied: ${applied.join(", ")}`);
}
