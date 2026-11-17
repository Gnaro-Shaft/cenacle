/**
 * The database owner stops being a superuser, once (ADR-0038, point 4).
 *
 * The image made cenacle_owner the cluster's bootstrap role (OID 10), which
 * Postgres never lets go of SUPERUSER, and for which REASSIGN OWNED is
 * refused. So the bootstrap role is renamed cenacle_admin — it keeps its
 * password — and a new cenacle_owner, no superuser, is given the database and
 * each of its objects, one by one. A role may not rename its own session's
 * role: a temporary superuser does it, in one transaction, then is dropped.
 *
 * Every failure says which of three it is: NothingChanged (checked: the
 * cluster is as before — the caller may throw its new passwords away), done
 * after all (the commit's answer was lost: returned as a success), or a plain
 * BasculeError (uncertain: the caller must keep every password it holds).
 * Nothing here reads or writes files: passwords come in, the CLI keeps them.
 */
import postgres from "postgres";
import { ownedLeft, ownedStatements } from "./bascule-objects.ts";

export const OWNER_ROLE = "cenacle_owner";
export const ADMIN_ROLE = "cenacle_admin";
/** The temporary superuser: it only renames the bootstrap role, then it goes. */
export const SWITCH_ROLE = "cenacle_bascule";
/** The programs' roles, handed to the new owner to manage (the copy's since ADR-0044). */
const PROGRAM_ROLES = ["cenacle_app", "cenacle_executor", "cenacle_copie"] as const;
const PASSWORD_RULE = /^[A-Za-z0-9_-]{16,128}$/;
const NAME_RULE = /^[a-z][a-z0-9_]{0,62}$/;

export class BasculeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BasculeError";
  }
}

/** Checked: the cluster is exactly as before the call. */
export class NothingChanged extends BasculeError {
  constructor(message: string) {
    super(message);
    this.name = "NothingChanged";
  }
}

export interface Cluster {
  readonly host: string;
  readonly port: string;
  /** Cénacle's database: it and its objects change owner. */
  readonly database: string;
  /** The test database: dropped, the tests recreate it with the new owner. */
  readonly testDatabase: string;
}

/** before: the bootstrap role is cenacle_owner; done: it is cenacle_admin. */
export type OwnerState = "before" | "done";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function connect(c: Cluster, role: string, password: string): postgres.Sql {
  const url = `postgres://${role}:${encodeURIComponent(password)}@${c.host}:${c.port}/${c.database}`;
  return postgres(url, { infer: true, max: 1, onnotice: () => {} });
}

async function withSql<T>(
  c: Cluster,
  role: string,
  pw: string,
  run: (sql: postgres.Sql) => Promise<T>,
) {
  const sql = connect(c, role, pw);
  try {
    return await run(sql);
  } finally {
    await sql.end();
  }
}

function checkInputs(c: Cluster, passwords: readonly string[]): void {
  for (const name of [c.database, c.testDatabase]) {
    if (!NAME_RULE.test(name)) throw new NothingChanged(`invalid database name: ${name}`);
  }
  // Passwords go into DDL (no bind parameters there): an allowlist, never escaping.
  if (!passwords.every((p) => PASSWORD_RULE.test(p))) {
    throw new NothingChanged("a password is not 16-128 chars of [A-Za-z0-9_-]");
  }
  if (new Set(passwords).size !== passwords.length) {
    throw new NothingChanged("the passwords must all differ");
  }
}

/** Where the cluster stands; anything but the two known shapes is refused, said plainly. */
export async function ownerState(sql: postgres.Sql, allowSwitchRole = false): Promise<OwnerState> {
  const rows = await sql<{ name: string; oid: number; super: boolean }[]>`
    select rolname as name, oid::int as oid, rolsuper as super from pg_roles
     where rolname in (${OWNER_ROLE}, ${ADMIN_ROLE}, ${SWITCH_ROLE})`;
  const role = (name: string) => rows.find((r) => r.name === name);
  if (!allowSwitchRole && role(SWITCH_ROLE) !== undefined) {
    throw new BasculeError(
      `${SWITCH_ROLE} exists: a switch was cut short — drop it as a superuser, then check the roles by hand`,
    );
  }
  const owner = role(OWNER_ROLE);
  const admin = role(ADMIN_ROLE);
  if (owner?.oid === 10 && owner.super && admin === undefined) return "before";
  if (admin?.oid === 10 && admin.super && owner !== undefined && !owner.super) return "done";
  throw new BasculeError(
    `unexpected roles (${rows.map((r) => `${r.name}: oid ${r.oid}, super ${r.super}`).join("; ") || "none"}): nothing done`,
  );
}

/** The state as `role` sees it with `password`, or null if it cannot log in or read it. */
async function stateAs(c: Cluster, role: string, password: string): Promise<OwnerState | null> {
  try {
    return await withSql(c, role, password, (sql) => ownerState(sql, true));
  } catch {
    return null;
  }
}

/**
 * A rename clears an MD5 password: the admin would be left with none. Only a
 * SCRAM password survives it (read by the superuser it belongs to).
 */
async function keepsItsPassword(sql: postgres.Sql): Promise<boolean> {
  const [row] = await sql<{ scram: boolean }[]>`
    select coalesce(rolpassword like 'SCRAM-SHA-256$%', false) as scram
      from pg_authid where rolname = current_user`;
  return row?.scram === true;
}

async function createSwitchRole(sql: postgres.Sql, password: string): Promise<void> {
  // Valid a quarter of an hour at most: a switch cut short leaves no lasting superuser login.
  const until = new Date(Date.now() + 15 * 60_000).toISOString();
  await sql.unsafe(
    `CREATE ROLE ${SWITCH_ROLE} LOGIN SUPERUSER PASSWORD '${password}' VALID UNTIL '${until}'`,
  );
}

/** Drops the temporary role, a few times if need be; false if it is still there. */
async function dropSwitchRole(c: Cluster, superRole: string, password: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await withSql(c, superRole, password, (sql) =>
        sql.unsafe(`DROP ROLE IF EXISTS ${SWITCH_ROLE}`),
      );
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}

/** The test database goes (the tests recreate it); a failure there is said, not fatal. */
async function dropTestDatabase(sql: postgres.Sql, c: Cluster): Promise<boolean> {
  try {
    await sql.unsafe(`DROP DATABASE IF EXISTS "${c.testDatabase}" WITH (FORCE)`);
    return true;
  } catch {
    return false;
  }
}

/** Why a transaction failed, in words: a lock held by a running program is the likely one. */
function why(error: unknown): string {
  return (error as { code?: string }).code === "55P03"
    ? "a running program held a lock for more than 5 s — run it again"
    : message(error);
}

/**
 * For a trial run: where the cluster stands and, before the switch, what it
 * would transfer — read with the owner's password, nothing changed.
 */
export async function switchPreview(c: Cluster, ownerPassword: string) {
  return withSql(c, OWNER_ROLE, ownerPassword, async (sql) => {
    const state = await ownerState(sql);
    if (state === "done") return { state, statements: [] as string[], scram: true };
    // Before the switch the bootstrap role still bears the owner's name.
    const statements = await ownedStatements(sql, OWNER_ROLE, OWNER_ROLE);
    return { state, statements, scram: await keepsItsPassword(sql) };
  });
}

export interface SwitchOptions {
  /** Tests only: runs inside the transaction, just before it commits. */
  readonly beforeCommit?: (tx: postgres.TransactionSql) => Promise<void>;
}

export interface Switched {
  readonly transferred: number;
  readonly testDropped: boolean;
  /** The temporary superuser could not be dropped: drop it by hand (it expires in 15 min). */
  readonly switchRoleLeft: boolean;
}

/** Before any change: checks, then the temporary superuser. Every failure here is NothingChanged. */
async function prepare(c: Cluster, role: string, password: string, want: OwnerState, temp: string) {
  try {
    await withSql(c, role, password, async (sql) => {
      if ((await ownerState(sql)) !== want) {
        throw new Error(want === "before" ? "already done" : "nothing to undo");
      }
      if (!(await keepsItsPassword(sql))) {
        throw new Error(
          `${role}'s password is not SCRAM: a rename would clear it — set it again first`,
        );
      }
      await createSwitchRole(sql, temp);
    });
  } catch (error) {
    throw error instanceof NothingChanged ? error : new NothingChanged(message(error));
  }
}

/**
 * Runs the switch's transaction as the temporary superuser, then sorts out
 * a failure: rolled back (checked), committed after all, or uncertain.
 */
async function transaction(
  c: Cluster,
  temp: string,
  steps: (tx: postgres.TransactionSql) => Promise<void>,
  undone: { readonly role: string; readonly state: OwnerState },
  done: { readonly role: string; readonly state: OwnerState },
  password: string,
): Promise<void> {
  const sql = connect(c, SWITCH_ROLE, temp);
  try {
    await sql.begin(async (tx) => {
      // Never queue long behind a running program's lock — nor make it queue behind us.
      await tx.unsafe("set local lock_timeout = '5s'");
      await steps(tx);
    });
  } catch (error) {
    await sql.end({ timeout: 1 }).catch(() => {});
    if ((await stateAs(c, undone.role, password)) === undone.state) {
      const dropped = await dropSwitchRole(c, undone.role, password);
      throw new NothingChanged(
        `${why(error)}${dropped ? "" : ` — and ${SWITCH_ROLE} is left: drop it as ${undone.role}`}`,
      );
    }
    if ((await stateAs(c, done.role, password)) === done.state) return; // the answer was lost
    throw new BasculeError(`${why(error)} — and the outcome is uncertain: check the roles by hand`);
  }
  await sql.end();
}

/**
 * The switch. `current` is the bootstrap role's password (today's .env.owner,
 * tomorrow's .env.admin); `next` the new owner's.
 */
export async function switchOwner(
  c: Cluster,
  passwords: { readonly current: string; readonly next: string; readonly temp: string },
  options: SwitchOptions = {},
): Promise<Switched> {
  checkInputs(c, [passwords.current, passwords.next, passwords.temp]);
  await prepare(c, OWNER_ROLE, passwords.current, "before", passwords.temp);
  let transferred = 0;
  await transaction(
    c,
    passwords.temp,
    async (tx) => {
      await tx.unsafe(`ALTER ROLE ${OWNER_ROLE} RENAME TO ${ADMIN_ROLE}`);
      await tx.unsafe(
        `CREATE ROLE ${OWNER_ROLE} LOGIN NOSUPERUSER CREATEROLE CREATEDB NOREPLICATION NOBYPASSRLS PASSWORD '${passwords.next}'`,
      );
      await tx.unsafe(`ALTER DATABASE "${c.database}" OWNER TO ${OWNER_ROLE}`);
      const statements = await ownedStatements(tx, ADMIN_ROLE, OWNER_ROLE);
      for (const statement of statements) await tx.unsafe(statement);
      transferred = statements.length;
      const left = await ownedLeft(tx, ADMIN_ROLE);
      if (left !== 0) throw new Error(`${left} object(s) the switch does not know: undone`);
      const programs = await tx<{ name: string }[]>`
        select rolname as name from pg_roles where rolname in ${tx(PROGRAM_ROLES)}`;
      for (const { name } of programs) {
        await tx.unsafe(`GRANT ${name} TO ${OWNER_ROLE} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
      }
      await tx.unsafe(`GRANT pg_signal_backend TO ${OWNER_ROLE}`);
      await options.beforeCommit?.(tx);
    },
    { role: OWNER_ROLE, state: "before" },
    { role: ADMIN_ROLE, state: "done" },
    passwords.current,
  );
  // Committed: from here the bootstrap role is cenacle_admin.
  const testDropped = await withSql(c, ADMIN_ROLE, passwords.current, (sql) =>
    dropTestDatabase(sql, c),
  );
  const switchRoleLeft = !(await dropSwitchRole(c, ADMIN_ROLE, passwords.current));
  return { transferred, testDropped, switchRoleLeft };
}

/**
 * Back as before (the rollback of ADR-0038): everything the new owner holds
 * goes back to the bootstrap role, the new owner is dropped, and the bootstrap
 * role is named cenacle_owner again — still with the admin's password.
 */
export async function switchBack(
  c: Cluster,
  passwords: { readonly admin: string; readonly temp: string },
): Promise<{ readonly switchRoleLeft: boolean }> {
  checkInputs(c, [passwords.admin, passwords.temp]);
  await prepare(c, ADMIN_ROLE, passwords.admin, "done", passwords.temp);
  // The test database is the new owner's: it must go before the owner can.
  if (!(await withSql(c, ADMIN_ROLE, passwords.admin, (sql) => dropTestDatabase(sql, c)))) {
    const dropped = await dropSwitchRole(c, ADMIN_ROLE, passwords.admin);
    throw new NothingChanged(
      `${c.testDatabase} could not be dropped${dropped ? "" : `, and ${SWITCH_ROLE} is left`}`,
    );
  }
  await transaction(
    c,
    passwords.temp,
    async (tx) => {
      // The new owner is no bootstrap role: REASSIGN works, and takes the database too.
      await tx.unsafe(`REASSIGN OWNED BY ${OWNER_ROLE} TO ${ADMIN_ROLE}`);
      await tx.unsafe(`DROP OWNED BY ${OWNER_ROLE}`);
      await tx.unsafe(`DROP ROLE ${OWNER_ROLE}`);
      await tx.unsafe(`ALTER ROLE ${ADMIN_ROLE} RENAME TO ${OWNER_ROLE}`);
    },
    { role: ADMIN_ROLE, state: "done" },
    { role: OWNER_ROLE, state: "before" },
    passwords.admin,
  );
  return { switchRoleLeft: !(await dropSwitchRole(c, OWNER_ROLE, passwords.admin)) };
}
