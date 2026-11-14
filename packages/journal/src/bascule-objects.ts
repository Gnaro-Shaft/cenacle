/**
 * What the switch of ADR-0038 moves, and the proof that nothing is left
 * behind. Objects are moved one by one: REASSIGN OWNED is refused for the
 * bootstrap role. The proof looks wider than the move — every schema that is
 * not the system's — so an object the move does not know stops the switch
 * instead of staying silently with the superuser.
 */
import type postgres from "postgres";

type Sql = postgres.Sql | postgres.TransactionSql;

/**
 * One ALTER … OWNER TO per object of the public schema that `from` owns.
 * Indexes, and the sequences a table owns, follow their table; array and row
 * types follow theirs.
 */
export async function ownedStatements(sql: Sql, from: string, to: string): Promise<string[]> {
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
    -- Enums, domains, ranges (a range's multirange follows it).
    select format('ALTER %s %s OWNER TO %I',
             case t.typtype when 'd' then 'DOMAIN' else 'TYPE' end, t.oid::regtype::text, ${to}::text)
      from pg_type t
     where t.typnamespace = 'public'::regnamespace and t.typowner = ${from}::regrole
       and t.typtype in ('e', 'd', 'r')
    union all
    -- Extended statistics do not follow their table.
    select format('ALTER STATISTICS %I.%I OWNER TO %I', 'public', s.stxname, ${to}::text)
      from pg_statistic_ext s
     where s.stxnamespace = 'public'::regnamespace and s.stxowner = ${from}::regrole
     order by 1`;
  return rows.map((r) => r.statement);
}

/**
 * What `role` still owns in the database, outside the system's schemas:
 * relations, functions, types, statistics, schemas. Must be 0 after the move.
 */
export async function ownedLeft(sql: Sql, role: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    with mine as (
      select oid from pg_namespace
       where nspname not in ('pg_catalog', 'information_schema')
         and nspname not like 'pg\\_toast%' and nspname not like 'pg\\_temp\\_%')
    select ((select count(*) from pg_class
              where relnamespace in (select oid from mine) and relowner = ${role}::regrole)
          + (select count(*) from pg_proc
              where pronamespace in (select oid from mine) and proowner = ${role}::regrole)
          + (select count(*) from pg_type
              where typnamespace in (select oid from mine) and typowner = ${role}::regrole)
          + (select count(*) from pg_statistic_ext
              where stxnamespace in (select oid from mine) and stxowner = ${role}::regrole)
          + (select count(*) from pg_namespace
              where oid in (select oid from mine) and nspowner = ${role}::regrole))::int as n`;
  return row?.n ?? -1;
}
