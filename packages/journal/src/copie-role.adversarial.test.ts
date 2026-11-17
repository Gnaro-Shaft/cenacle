// ADR-0044: the nightly copy's role reads four tables and the sequences they
// own — and nothing else. Every other table and sequence of the schema is
// tried, not a sample: one added tomorrow is refused unless it is listed. It
// writes nowhere, draws no identity value, runs no purge; a right given by
// hand is taken back by the next migration.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  APP_ROLE,
  COPIE_PASSWORD_VAR,
  COPIE_ROLE,
  COPIE_TABLES,
  EXECUTOR_PASSWORD_VAR,
  EXECUTOR_ROLE,
  migrate,
  ownerUrlFromEnv,
  requireEnv,
} from "./migrate.ts";
import { copieConnection, loadEnv, TEST_DB } from "./test-db.ts";

const DENIED = "42501"; // insufficient_privilege
let owner: postgres.Sql;
let copie: postgres.Sql;
let tables: string[];
let sequences: { seq: string; table: string | null }[];
/** A plain column of each copied table (an identity column refuses UPDATE before any right is looked at). */
let plain: Map<string, string>;

beforeAll(async () => {
  loadEnv();
  owner = postgres(ownerUrlFromEnv(TEST_DB), { infer: true, max: 1, onnotice: () => {} });
  copie = copieConnection();
  tables = (
    await owner<{ name: string }[]>`
      select relname as name from pg_class
       where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') order by 1`
  ).map((r) => r.name);
  sequences = await owner<{ seq: string; table: string | null }[]>`
    select s.oid::regclass::text as seq, t.relname as table
      from pg_class s
      left join pg_depend d on d.classid = 'pg_class'::regclass and d.objid = s.oid
                           and d.refclassid = 'pg_class'::regclass and d.deptype in ('a', 'i')
      left join pg_class t on t.oid = d.refobjid
     where s.relkind = 'S' and s.relnamespace = 'public'::regnamespace
     order by 1`;
  const columns = await owner<{ table: string; column: string }[]>`
    select distinct on (c.relname) c.relname as table, a.attname as column
      from pg_attribute a join pg_class c on c.oid = a.attrelid
     where c.relnamespace = 'public'::regnamespace and c.relname = any(${[...COPIE_TABLES]})
       and a.attnum > 0 and not a.attisdropped and a.attidentity = '' and a.attgenerated = ''
     order by c.relname, a.attnum`;
  plain = new Map(columns.map((c) => [c.table, c.column]));
});
afterAll(async () => {
  await copie?.end();
  await owner?.end();
});

/** The SQLSTATE a statement of the copy's role fails with, or "ok". */
async function asCopie(statement: string): Promise<string> {
  try {
    await copie.begin(async (tx) => {
      await tx.unsafe(statement);
      throw new Error("undo"); // never keep what passed
    });
    return "ok";
  } catch (error) {
    if (error instanceof Error && error.message === "undo") return "ok";
    return (error as { code?: string }).code ?? String(error);
  }
}

const copied = (t: string) => (COPIE_TABLES as readonly string[]).includes(t);

describe("what the copy's role reads", () => {
  it("the list is the ADR's four, written here by hand: never the mail memory's marks", () => {
    expect([...COPIE_TABLES].sort()).toEqual([
      "prospection_cartes",
      "rappels",
      "securite_constats",
      "veille_articles",
    ]);
  });

  it("the scan really sees the schema", () => {
    expect(tables.length).toBeGreaterThan(15);
    for (const t of [...COPIE_TABLES, "events", "mail_items", "prospection_mails_lus"]) {
      expect(tables).toContain(t);
    }
    expect(sequences.filter((s) => s.table !== null && copied(s.table))).toHaveLength(4);
  });

  it("each of the four tables, and no other table of the schema", async () => {
    const readable: string[] = [];
    for (const t of tables) {
      const state = await asCopie(`select * from ${t} limit 1`);
      if (state === "ok") readable.push(t);
      else expect(state, t).toBe(DENIED);
    }
    expect(readable).toEqual([...COPIE_TABLES].sort());
  });

  it("the sequences of the four tables, and no other sequence", async () => {
    const readable: string[] = [];
    for (const { seq } of sequences) {
      const state = await asCopie(`select last_value, is_called from ${seq}`);
      if (state === "ok") readable.push(seq);
      else expect(state, seq).toBe(DENIED);
    }
    expect(readable).toEqual(
      sequences.filter((s) => s.table !== null && copied(s.table)).map((s) => s.seq),
    );
  });
});

describe("what it never does", () => {
  it.each([...COPIE_TABLES])("writes nothing in %s", async (t) => {
    for (const statement of [
      `insert into ${t} default values`,
      `update ${t} set ${plain.get(t) ?? "missing"} = ${plain.get(t) ?? "missing"}`,
      `delete from ${t}`,
      `truncate ${t}`,
      `lock table ${t} in access exclusive mode`,
    ]) {
      expect(await asCopie(statement), statement).toBe(DENIED);
    }
  });

  it("draws or sets no identity value", async () => {
    for (const { seq } of sequences) {
      expect(await asCopie(`select nextval('${seq}')`), seq).toBe(DENIED);
      expect(await asCopie(`select setval('${seq}', 1)`), seq).toBe(DENIED);
    }
  });

  it.each([
    "select purge_events(now())",
    "select purge_proposals(now())",
    "select erase_proposals_for('x', array[]::bigint[])",
    "select purge_floor_holds('x', now())",
  ])("runs no purge: %s", async (statement) => {
    expect(await asCopie(statement)).toBe(DENIED);
  });

  it("changes no structure, makes no table", async () => {
    expect(await asCopie("create table copie_probe (x int)")).toBe(DENIED);
    expect(await asCopie(`alter table rappels add column x int`)).toBe(DENIED);
    expect(await asCopie(`grant select on events to ${COPIE_ROLE}`)).toBe(DENIED);
  });

  it("borrows no other role's rights", async () => {
    for (const role of [APP_ROLE, EXECUTOR_ROLE, "cenacle_owner"]) {
      expect(await asCopie(`set role ${role}`), role).toBe(DENIED);
    }
  });
});

describe("a right given by hand does not last", () => {
  it("the next migration takes it back, and keeps the four", async () => {
    await owner.unsafe(`GRANT SELECT, INSERT ON events TO ${COPIE_ROLE}`);
    await owner.unsafe(`GRANT INSERT ON rappels TO ${COPIE_ROLE}`);
    await owner.unsafe(`GRANT SELECT (uid) ON mail_items TO ${COPIE_ROLE}`);
    const seq = sequences.find((s) => s.table === "events")?.seq ?? "missing";
    await owner.unsafe(`GRANT USAGE ON SEQUENCE ${seq} TO ${COPIE_ROLE}`);
    expect(await asCopie("select * from events limit 1")).toBe("ok");
    expect(await asCopie(`select nextval('${seq}')`)).toBe("ok");
    expect(await asCopie("select uid from mail_items limit 1")).toBe("ok");

    await migrate({
      ownerUrl: ownerUrlFromEnv(TEST_DB),
      appPassword: requireEnv("CENACLE_DB_APP_PASSWORD"),
      executorPassword: requireEnv(EXECUTOR_PASSWORD_VAR),
      copiePassword: requireEnv(COPIE_PASSWORD_VAR),
    });
    expect(await asCopie("select * from events limit 1")).toBe(DENIED);
    expect(await asCopie("insert into rappels default values")).toBe(DENIED);
    expect(await asCopie("select uid from mail_items limit 1")).toBe(DENIED);
    expect(await asCopie(`select nextval('${seq}')`)).toBe(DENIED);
    expect(await asCopie("select * from rappels limit 1")).toBe("ok");
  });
});
