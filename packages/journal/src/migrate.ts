/**
 * Applies the schema and sets up the application role.
 *
 * Runs as the database owner. The application itself never connects as
 * the owner: it uses `cenacle_app`, which may only INSERT and SELECT.
 *
 * Usage: node --env-file=.env packages/journal/src/migrate.ts
 * (self-contained on purpose: no relative imports, so Node can run it directly)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

export const APP_ROLE = "cenacle_app";
const SQL_DIR = join(import.meta.dirname, "..", "sql");
const PASSWORD_RULE = /^[A-Za-z0-9_-]{16,128}$/;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing environment variable ${name} (see .env.example)`);
  }
  return value;
}

export interface MigrateOptions {
  ownerUrl: string;
  appPassword: string;
}

export async function migrate({ ownerUrl, appPassword }: MigrateOptions): Promise<string[]> {
  // The password is interpolated into DDL (Postgres does not accept bind
  // parameters there), so it must match a strict allowlist — never escape.
  if (!PASSWORD_RULE.test(appPassword)) {
    throw new Error("CENACLE_DB_APP_PASSWORD must be 16-128 chars of [A-Za-z0-9_-]");
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
    const [exists] = await sql`select 1 from pg_roles where rolname = ${APP_ROLE}`;
    const verb = exists === undefined ? "CREATE" : "ALTER";
    await sql.unsafe(
      `${verb} ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${appPassword}'`,
    );
    await sql.unsafe(`GRANT CONNECT ON DATABASE "${db.name}" TO ${APP_ROLE}`);
    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
    await sql.unsafe(`REVOKE ALL ON events FROM ${APP_ROLE}`);
    await sql.unsafe(`GRANT INSERT, SELECT ON events TO ${APP_ROLE}`);
  } finally {
    await sql.end();
  }
  return applied;
}

function ownerUrlFromEnv(database: string): string {
  const host = process.env.CENACLE_DB_HOST ?? "127.0.0.1";
  const port = process.env.CENACLE_DB_PORT ?? "55432";
  const password = encodeURIComponent(requireEnv("CENACLE_DB_OWNER_PASSWORD"));
  return `postgres://cenacle_owner:${password}@${host}:${port}/${database}`;
}

export function urlsFromEnv(database: string): { ownerUrl: string; appUrl: string } {
  const host = process.env.CENACLE_DB_HOST ?? "127.0.0.1";
  const port = process.env.CENACLE_DB_PORT ?? "55432";
  const appPassword = encodeURIComponent(requireEnv("CENACLE_DB_APP_PASSWORD"));
  return {
    ownerUrl: ownerUrlFromEnv(database),
    appUrl: `postgres://${APP_ROLE}:${appPassword}@${host}:${port}/${database}`,
  };
}

if (import.meta.main) {
  const applied = await migrate({
    ownerUrl: ownerUrlFromEnv("cenacle"),
    appPassword: requireEnv("CENACLE_DB_APP_PASSWORD"),
  });
  console.log(`Migrations applied: ${applied.join(", ")}`);
}
