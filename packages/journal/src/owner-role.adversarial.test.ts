// ADR-0038: the role the migrations run as is no superuser. It migrates,
// recreates the test database and manages the programs' roles — and is
// refused everything beyond Cénacle's objects: a system command, a file of
// the server, the server's settings, a superuser of its own.
//
// Run where the owner still IS a superuser (before npm run db:bascule), those
// statements would succeed — a superuser role created, a command run. So the
// file fails at once there, before running any of them; and every statement
// that could leave a role behind runs in a transaction that is always undone.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  APP_ROLE,
  COPIE_PASSWORD_VAR,
  COPIE_ROLE,
  EXECUTOR_PASSWORD_VAR,
  EXECUTOR_ROLE,
  lockedDown,
  migrate,
  ownerUrlFromEnv,
  requireEnv,
  runsAsSuperuser,
} from "./migrate.ts";
import { appConnection, loadEnv, resetTestDatabase, TEST_DB } from "./test-db.ts";

const PROBE = "cenacle_probe_0038";
const SUPERUSER_OWNER = "the owner is a superuser here: nothing was run (npm run db:bascule)";
let owner: postgres.Sql;
let superuser = true;

class Undo extends Error {}

/**
 * The SQLSTATE a statement fails with, or "ok" — never run by a superuser
 * owner, and undone even when it passes (ALTER SYSTEM alone cannot run in a
 * transaction: it is refused to a non-superuser before anything is written).
 */
async function outcome(statement: string): Promise<string> {
  expect(superuser, SUPERUSER_OWNER).toBe(false);
  try {
    if (statement.startsWith("ALTER SYSTEM")) {
      await owner.unsafe(statement);
    } else {
      await owner.begin(async (tx) => {
        await tx.unsafe(statement);
        throw new Undo();
      });
    }
    return "ok";
  } catch (error) {
    if (error instanceof Undo) return "ok";
    return String((error as { code?: string }).code ?? error);
  }
}

beforeAll(async () => {
  loadEnv();
  superuser = await runsAsSuperuser(ownerUrlFromEnv(TEST_DB));
  owner = postgres(ownerUrlFromEnv(TEST_DB), { infer: true, max: 1, onnotice: () => {} });
});

afterAll(async () => {
  if (!superuser) await owner.unsafe(`DROP ROLE IF EXISTS ${PROBE}`);
  await owner.end();
});

describe("the owner is no superuser (ADR-0038)", () => {
  it("the role the migrations run as is not a superuser", async () => {
    expect(await runsAsSuperuser(ownerUrlFromEnv(TEST_DB))).toBe(false);
    const [me] = await owner<{ name: string; createrole: boolean; createdb: boolean }[]>`
      select rolname as name, rolcreaterole as createrole, rolcreatedb as createdb
        from pg_roles where rolname = current_user`;
    expect(me).toEqual({ name: "cenacle_owner", createrole: true, createdb: true });
  });

  it.each([
    ["a system command", "COPY (select 1) TO PROGRAM 'id'"],
    ["a file of the server", "select pg_read_file('/etc/passwd')"],
    ["a directory of the server", "select pg_ls_dir('/')"],
    ["a file written on the server", "COPY (select 1) TO '/tmp/cenacle-0038'"],
    ["the server's settings", "ALTER SYSTEM SET log_statement = 'all'"],
    ["a superuser of its own", "CREATE ROLE cenacle_evil_0038 SUPERUSER"],
    ["becoming a superuser", "ALTER ROLE cenacle_owner SUPERUSER"],
    ["the admin's password", "ALTER ROLE cenacle_admin PASSWORD 'stolen-stolen-stolen'"],
    ["a role that bypasses row security", "CREATE ROLE cenacle_evil_0038 BYPASSRLS"],
  ])("is refused %s", async (_what, statement) => {
    expect(await outcome(statement)).toBe("42501");
  });

  it("owns the test database and every object in it, nobody else does", async () => {
    const [db] = await owner<{ owner: string }[]>`
      select pg_get_userbyid(datdba) as owner from pg_database where datname = current_database()`;
    expect(db?.owner).toBe("cenacle_owner");
    const foreign = await owner<{ what: string }[]>`
      select relname || ' (' || pg_get_userbyid(relowner) || ')' as what
        from pg_class where relnamespace = 'public'::regnamespace
         and pg_get_userbyid(relowner) <> 'cenacle_owner'
      union all
      select proname || ' (' || pg_get_userbyid(proowner) || ')'
        from pg_proc where pronamespace = 'public'::regnamespace
         and pg_get_userbyid(proowner) <> 'cenacle_owner'
      union all
      select typname || ' (' || pg_get_userbyid(typowner) || ')'
        from pg_type where typnamespace = 'public'::regnamespace
         and pg_get_userbyid(typowner) <> 'cenacle_owner'`;
    expect(foreign.map((f) => f.what)).toEqual([]);
    // The check is not empty-handed: there are objects to own.
    const [count] = await owner<{ n: number }[]>`
      select count(*)::int as n from pg_class where relnamespace = 'public'::regnamespace`;
    expect(count?.n).toBeGreaterThan(10);
  });

  it("recreates the test database while a program is connected to it", async () => {
    const app = appConnection();
    try {
      await app`select 1`;
      // DROP DATABASE … WITH (FORCE) cuts the app's connection: pg_signal_backend.
      await resetTestDatabase();
    } finally {
      await app.end({ timeout: 1 }).catch(() => {});
    }
    const again = appConnection();
    try {
      expect(await again`select count(*)::int as n from events`).toEqual([{ n: 0 }]);
    } finally {
      await again.end();
    }
  });

  it("migrates twice: the programs' roles get their password back, and stay locked down", async () => {
    const options = {
      ownerUrl: ownerUrlFromEnv(TEST_DB),
      appPassword: requireEnv("CENACLE_DB_APP_PASSWORD"),
      executorPassword: requireEnv(EXECUTOR_PASSWORD_VAR),
      copiePassword: requireEnv(COPIE_PASSWORD_VAR),
    };
    await migrate(options);
    await migrate(options);
    for (const role of [APP_ROLE, EXECUTOR_ROLE, COPIE_ROLE]) {
      await expect(lockedDown(owner, role)).resolves.toBeUndefined();
    }
  });
});

describe("a program's role that gained a right stops the migration (ADR-0038, point 3)", () => {
  beforeAll(async () => {
    if (superuser) throw new Error(SUPERUSER_OWNER);
    await owner.unsafe(`DROP ROLE IF EXISTS ${PROBE}`);
    // NOLOGIN: the probe never opens a session, whatever it is given.
    await owner.unsafe(`CREATE ROLE ${PROBE} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE`);
  });

  it("a role with nothing more passes", async () => {
    await expect(lockedDown(owner, PROBE)).resolves.toBeUndefined();
  });

  it.each([
    ["CREATEDB", `ALTER ROLE ${PROBE} CREATEDB`, `ALTER ROLE ${PROBE} NOCREATEDB`],
    ["CREATEROLE", `ALTER ROLE ${PROBE} CREATEROLE`, `ALTER ROLE ${PROBE} NOCREATEROLE`],
    [
      `member of ${EXECUTOR_ROLE}`,
      `GRANT ${EXECUTOR_ROLE} TO ${PROBE}`,
      `REVOKE ${EXECUTOR_ROLE} FROM ${PROBE}`,
    ],
  ])("is refused, naming it: %s", async (right, give, take) => {
    await owner.unsafe(give);
    try {
      await expect(lockedDown(owner, PROBE)).rejects.toThrow(right);
      await expect(lockedDown(owner, PROBE)).rejects.toThrow(/cenacle_admin/);
    } finally {
      await owner.unsafe(take);
    }
    await expect(lockedDown(owner, PROBE)).resolves.toBeUndefined();
  });

  it("a missing role is said, not taken for a clean one", async () => {
    await expect(lockedDown(owner, "cenacle_nobody_0038")).rejects.toThrow(/missing/);
  });
});
