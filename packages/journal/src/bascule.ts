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
 * Nothing here reads or writes files: passwords come in, the CLI keeps them.
 */
import postgres from "postgres";

export const OWNER_ROLE = "cenacle_owner";
export const ADMIN_ROLE = "cenacle_admin";
/** The temporary superuser: it only renames the bootstrap role, then it goes. */
export const SWITCH_ROLE = "cenacle_bascule";
const PROGRAM_ROLES = ["cenacle_app", "cenacle_executor"] as const;
const PASSWORD_RULE = /^[A-Za-z0-9_-]{16,128}$/;
const NAME_RULE = /^[a-z][a-z0-9_]{0,62}$/;

export class BasculeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BasculeError";
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

function url(c: Cluster, role: string, password: string, database = c.database): string {
  return `postgres://${role}:${encodeURIComponent(password)}@${c.host}:${c.port}/${database}`;
}

function connect(c: Cluster, role: string, password: string): postgres.Sql {
  return postgres(url(c, role, password), { infer: true, max: 1, onnotice: () => {} });
}

function checkInputs(c: Cluster, passwords: readonly string[]): void {
  for (const name of [c.database, c.testDatabase]) {
    if (!NAME_RULE.test(name)) throw new BasculeError(`invalid database name: ${name}`);
  }
  // Passwords go into DDL (no bind parameters there): an allowlist, never escaping.
  if (!passwords.every((p) => PASSWORD_RULE.test(p))) {
    throw new BasculeError("a password is not 16-128 chars of [A-Za-z0-9_-]");
  }
  if (new Set(passwords).size !== passwords.length) {
    throw new BasculeError("the passwords must all differ");
  }
}

/** Where the cluster stands; anything but the two known shapes is refused, said plainly. */
export async function ownerState(sql: postgres.Sql): Promise<OwnerState> {
  const rows = await sql<{ name: string; oid: number; super: boolean }[]>`
    select rolname as name, oid::int as oid, rolsuper as super from pg_roles
     where rolname in (${OWNER_ROLE}, ${ADMIN_ROLE}, ${SWITCH_ROLE})`;
  const role = (name: string) => rows.find((r) => r.name === name);
  if (role(SWITCH_ROLE) !== undefined) {
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

/**
 * One ALTER … OWNER TO per object of the public schema that `from` owns.
 * Indexes, and the sequences a table owns, follow their table; array and row
 * types follow theirs.
 */
export async function ownedStatements(
  sql: postgres.Sql | postgres.TransactionSql,
  from: string,
  to: string,
): Promise<string[]> {
  const rows = await sql<{ statement: string }[]>`
    select format('ALTER %s %s OWNER TO %I',
             case c.relkind when 'v' then 'VIEW' when 'm' then 'MATERIALIZED VIEW'
                            when 'S' then 'SEQUENCE' else 'TABLE' end,
             format('%I.%I', n.nspname, c.relname), ${to}::text) as statement
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')
       and c.relowner = ${from}::regrole
       and not (c.relkind = 'S' and exists (
             select 1 from pg_depend d
              where d.classid = 'pg_class'::regclass and d.objid = c.oid
                and d.refclassid = 'pg_class'::regclass and d.deptype in ('a', 'i')))
    union all
    select format('ALTER %s %s OWNER TO %I',
             case p.prokind when 'p' then 'PROCEDURE' when 'a' then 'AGGREGATE' else 'FUNCTION' end,
             p.oid::regprocedure::text, ${to}::text)
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proowner = ${from}::regrole
    union all
    select format('ALTER %s %s OWNER TO %I',
             case t.typtype when 'd' then 'DOMAIN' else 'TYPE' end, t.oid::regtype::text, ${to}::text)
      from pg_type t
     where t.typnamespace = 'public'::regnamespace and t.typowner = ${from}::regrole
       and t.typtype in ('e', 'd', 'r', 'm')
     order by 1`;
  return rows.map((r) => r.statement);
}

/** What `role` still owns in the public schema: must be nothing once the switch is done. */
export async function ownedLeft(
  sql: postgres.Sql | postgres.TransactionSql,
  role: string,
): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select ((select count(*) from pg_class
              where relnamespace = 'public'::regnamespace and relowner = ${role}::regrole)
          + (select count(*) from pg_proc
              where pronamespace = 'public'::regnamespace and proowner = ${role}::regrole)
          + (select count(*) from pg_type
              where typnamespace = 'public'::regnamespace and typowner = ${role}::regrole))::int as n`;
  return row?.n ?? -1;
}

async function createSwitchRole(sql: postgres.Sql, password: string): Promise<void> {
  // Valid a quarter of an hour at most: a switch cut short leaves no lasting superuser login.
  const until = new Date(Date.now() + 15 * 60_000).toISOString();
  await sql.unsafe(
    `CREATE ROLE ${SWITCH_ROLE} LOGIN SUPERUSER PASSWORD '${password}' VALID UNTIL '${until}'`,
  );
}

async function dropSwitchRole(c: Cluster, superRole: string, password: string): Promise<void> {
  const sql = connect(c, superRole, password);
  try {
    await sql.unsafe(`DROP ROLE IF EXISTS ${SWITCH_ROLE}`);
  } finally {
    await sql.end();
  }
}

/** After a failure: drop the temporary role, and never let that hide the first error. */
async function undoSwitchRole(
  c: Cluster,
  superRole: string,
  password: string,
  first: unknown,
): Promise<never> {
  try {
    await dropSwitchRole(c, superRole, password);
  } catch {
    throw new BasculeError(
      `${first instanceof Error ? first.message : String(first)} — and ${SWITCH_ROLE} could not be dropped: drop it by hand as ${superRole}`,
    );
  }
  throw first;
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

/**
 * For a trial run: where the cluster stands and, before the switch, what it
 * would transfer — read with the owner's password, nothing changed.
 */
export async function switchPreview(
  c: Cluster,
  ownerPassword: string,
): Promise<{ readonly state: OwnerState; readonly statements: readonly string[] }> {
  const sql = connect(c, OWNER_ROLE, ownerPassword);
  try {
    const state = await ownerState(sql);
    // Before the switch the bootstrap role still bears the owner's name.
    const statements = state === "before" ? await ownedStatements(sql, OWNER_ROLE, OWNER_ROLE) : [];
    return { state, statements };
  } finally {
    await sql.end();
  }
}

export interface SwitchOptions {
  /** Tests only: runs inside the transaction, just before it commits. */
  readonly beforeCommit?: (tx: postgres.TransactionSql) => Promise<void>;
}

/**
 * The switch. `current` is the bootstrap role's password (today's .env.owner,
 * tomorrow's .env.admin); `next` the new owner's. All in one transaction: on
 * any error, nothing changed but the temporary role, which is dropped.
 */
export async function switchOwner(
  c: Cluster,
  passwords: { readonly current: string; readonly next: string; readonly temp: string },
  options: SwitchOptions = {},
): Promise<{ readonly transferred: number; readonly testDropped: boolean }> {
  checkInputs(c, [passwords.current, passwords.next, passwords.temp]);
  const boot = connect(c, OWNER_ROLE, passwords.current);
  try {
    if ((await ownerState(boot)) !== "before") throw new BasculeError("already done");
    await createSwitchRole(boot, passwords.temp);
  } finally {
    await boot.end();
  }
  let transferred = 0;
  const temp = connect(c, SWITCH_ROLE, passwords.temp);
  try {
    await temp.begin(async (tx) => {
      await tx.unsafe(`ALTER ROLE ${OWNER_ROLE} RENAME TO ${ADMIN_ROLE}`);
      await tx.unsafe(
        `CREATE ROLE ${OWNER_ROLE} LOGIN NOSUPERUSER CREATEROLE CREATEDB NOREPLICATION NOBYPASSRLS PASSWORD '${passwords.next}'`,
      );
      await tx.unsafe(`ALTER DATABASE "${c.database}" OWNER TO ${OWNER_ROLE}`);
      const statements = await ownedStatements(tx, ADMIN_ROLE, OWNER_ROLE);
      for (const statement of statements) await tx.unsafe(statement);
      transferred = statements.length;
      const left = await ownedLeft(tx, ADMIN_ROLE);
      if (left !== 0) throw new BasculeError(`${left} object(s) left to ${ADMIN_ROLE}: undone`);
      const programs = await tx<{ name: string }[]>`
        select rolname as name from pg_roles where rolname in ${tx(PROGRAM_ROLES)}`;
      for (const { name } of programs) {
        await tx.unsafe(`GRANT ${name} TO ${OWNER_ROLE} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
      }
      await tx.unsafe(`GRANT pg_signal_backend TO ${OWNER_ROLE}`);
      await options.beforeCommit?.(tx);
    });
  } catch (error) {
    await temp.end();
    // Rolled back: the bootstrap role is still cenacle_owner, with its password.
    return undoSwitchRole(c, OWNER_ROLE, passwords.current, error);
  }
  // Committed: from here the bootstrap role is cenacle_admin.
  const testDropped = await dropTestDatabase(temp, c);
  await temp.end();
  await dropSwitchRole(c, ADMIN_ROLE, passwords.current);
  return { transferred, testDropped };
}

/**
 * Back as before (the rollback of ADR-0038): everything the new owner holds
 * goes back to the bootstrap role, the new owner is dropped, and the bootstrap
 * role is named cenacle_owner again — still with the admin's password.
 */
export async function switchBack(
  c: Cluster,
  passwords: { readonly admin: string; readonly temp: string },
): Promise<void> {
  checkInputs(c, [passwords.admin, passwords.temp]);
  const admin = connect(c, ADMIN_ROLE, passwords.admin);
  try {
    if ((await ownerState(admin)) !== "done") throw new BasculeError("nothing to undo");
    await createSwitchRole(admin, passwords.temp);
  } finally {
    await admin.end();
  }
  const temp = connect(c, SWITCH_ROLE, passwords.temp);
  try {
    // The test database is the new owner's: it must go before the owner can.
    if (!(await dropTestDatabase(temp, c))) {
      throw new BasculeError(`${c.testDatabase} could not be dropped: nothing undone`);
    }
    await temp.begin(async (tx) => {
      // The new owner is no bootstrap role: REASSIGN works, and takes the database too.
      await tx.unsafe(`REASSIGN OWNED BY ${OWNER_ROLE} TO ${ADMIN_ROLE}`);
      await tx.unsafe(`DROP OWNED BY ${OWNER_ROLE}`);
      await tx.unsafe(`DROP ROLE ${OWNER_ROLE}`);
      await tx.unsafe(`ALTER ROLE ${ADMIN_ROLE} RENAME TO ${OWNER_ROLE}`);
    });
  } catch (error) {
    await temp.end();
    return undoSwitchRole(c, ADMIN_ROLE, passwords.admin, error);
  }
  await temp.end();
  await dropSwitchRole(c, OWNER_ROLE, passwords.admin);
}
