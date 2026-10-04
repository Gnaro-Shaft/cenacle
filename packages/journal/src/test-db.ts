/**
 * Test database helpers. Tests run against a real PostgreSQL — the
 * guarantees we test (triggers, privileges) only exist there.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import {
  appUrlFromEnv,
  EXECUTOR_PASSWORD_VAR,
  executorUrlFromEnv,
  migrate,
  ownerUrlFromEnv,
  requireEnv,
} from "./migrate.ts";

export const TEST_DB = "cenacle_test";

/** Turns a raw connection error into an actionable message. */
function explainConnectionError(error: unknown): string {
  const text = String(error);
  if (text.includes("password authentication failed")) {
    return (
      "PostgreSQL rejected the owner password from .env. The database volume was " +
      "probably created with another password (POSTGRES_PASSWORD only applies on first " +
      "start). If it holds nothing you need: docker compose down -v && npm run db:up " +
      `&& npm run db:migrate\n${text}`
    );
  }
  if (text.includes("ECONNREFUSED")) {
    return `PostgreSQL is not running — start it with: npm run db:up\n${text}`;
  }
  return `Unexpected PostgreSQL error\n${text}`;
}

/**
 * .env, the owner's password (.env.owner) and the executor's (.env.executor):
 * the tests create the test database, and roles are shared by the whole cluster.
 */
export function loadEnv(): void {
  for (const name of [".env", ".env.owner", ".env.executor"]) {
    const file = join(import.meta.dirname, "..", "..", "..", name);
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

/** Recreates the test database from scratch and migrates it. */
export async function resetTestDatabase(): Promise<void> {
  loadEnv();
  requireEnv("CENACLE_DB_OWNER_PASSWORD");
  const ownerUrl = ownerUrlFromEnv("postgres");
  const admin = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
  } catch (error) {
    throw new Error(explainConnectionError(error));
  } finally {
    await admin.end();
  }
  await migrate({
    ownerUrl: ownerUrlFromEnv(TEST_DB),
    appPassword: requireEnv("CENACLE_DB_APP_PASSWORD"),
    executorPassword: requireEnv(EXECUTOR_PASSWORD_VAR),
  });
}

export function appConnection() {
  loadEnv();
  return postgres(appUrlFromEnv(TEST_DB), { max: 2, onnotice: () => {} });
}

/** The executor's connection to the test database. */
export function executorConnection() {
  loadEnv();
  return postgres(executorUrlFromEnv(TEST_DB), { max: 2, onnotice: () => {} });
}
