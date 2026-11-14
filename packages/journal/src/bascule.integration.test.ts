// ADR-0038, point 4: the switch, on a throwaway Postgres laid out like an
// existing install — cenacle_owner is the image's bootstrap superuser. Never
// on the real database: the container is started here and removed after.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ADMIN_ROLE,
  type Cluster,
  NothingChanged,
  OWNER_ROLE,
  ownerState,
  SWITCH_ROLE,
  switchBack,
  switchOwner,
} from "./bascule.ts";
import { ownedLeft } from "./bascule-objects.ts";
import { migrate } from "./migrate.ts";

const IMAGE = process.env.CENACLE_TEST_PG_IMAGE ?? "postgres:18-alpine";
const NAME = `cenacle-bascule-test-${process.pid}`;
const draw = () => randomBytes(24).toString("hex");
const P0 = draw(); // the bootstrap role's password: today's .env.owner
const P1 = draw(); // the new owner's
const APP = draw();
const EXECUTOR = draw();
let cluster: Cluster;

const url = (role: string, password: string, db = "cenacle") =>
  `postgres://${role}:${password}@127.0.0.1:${cluster.port}/${db}`;
const as = (role: string, password: string, db = "cenacle") =>
  postgres(url(role, password, db), { infer: true, max: 1, onnotice: () => {} });

/** Runs `run` with a connection, always closed. */
async function withSql<T>(role: string, password: string, run: (sql: postgres.Sql) => Promise<T>) {
  const sql = as(role, password);
  try {
    return await run(sql);
  } finally {
    await sql.end();
  }
}

/** A shell command inside the throwaway container, over its local socket (trusted). */
const inContainer = (command: string) =>
  execFileSync("docker", ["exec", NAME, "sh", "-c", command], { stdio: "ignore" });

const code = (error: unknown) => String((error as { code?: string }).code ?? error);

/** Which role the bootstrap password opens now: the admin after a switch, the owner before. */
async function roles() {
  return withSql(ADMIN_ROLE, P0, async (sql) => sql`select 1`).then(
    () => "admin",
    () => "owner",
  );
}

beforeAll(async () => {
  execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "--name",
      NAME,
      "-p",
      "127.0.0.1::5432",
      "-e",
      "POSTGRES_USER=cenacle_owner",
      "-e",
      `POSTGRES_PASSWORD=${P0}`,
      "-e",
      "POSTGRES_DB=cenacle",
      IMAGE,
    ],
    { stdio: "ignore" },
  );
  const port =
    execFileSync("docker", ["port", NAME, "5432/tcp"], { encoding: "utf8" })
      .trim()
      .split(":")
      .pop() ?? "";
  cluster = { host: "127.0.0.1", port, database: "cenacle", testDatabase: "cenacle_test" };
  // Over TCP only once the image's init is over (it listens on the socket alone until then).
  for (let i = 0; ; i++) {
    try {
      await withSql(OWNER_ROLE, P0, async (sql) => sql`select 1`);
      break;
    } catch (error) {
      if (i > 120) throw error;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await migrate({ ownerUrl: url(OWNER_ROLE, P0), appPassword: APP, executorPassword: EXECUTOR });
  await withSql(OWNER_ROLE, P0, async (sql) => {
    await sql`insert into purge_planchers (cle, jours) values ('journal_jours', 180), ('propositions_jours', 90)`;
    await sql.unsafe("CREATE DATABASE cenacle_test");
    // Extended statistics do not follow their table: the switch must move them itself.
    await sql.unsafe(
      "CREATE STATISTICS events_agent_type (dependencies) ON agent, type FROM events",
    );
  });
  await withSql("cenacle_app", APP, async (sql) => {
    await sql`insert into events (agent, type, payload) values ('bascule', 'heartbeat', '{}')`;
  });
}, 120_000);

afterAll(() => {
  execFileSync("docker", ["rm", "-f", NAME], { stdio: "ignore" });
});

describe("the switch refuses before touching anything", () => {
  it.each([
    ["two equal passwords", { current: P0, next: P0, temp: draw() }],
    ["a password with a quote", { current: P0, next: `${draw()}'x`, temp: draw() }],
    ["a short password", { current: P0, next: "short", temp: draw() }],
  ])("%s", async (_what, passwords) => {
    await expect(switchOwner(cluster, passwords)).rejects.toThrow(NothingChanged);
    expect(await roles()).toBe("owner");
  });

  it("a wrong current password: refused by the database, nothing changed", async () => {
    await expect(switchOwner(cluster, { current: draw(), next: P1, temp: draw() })).rejects.toThrow(
      NothingChanged,
    );
    expect(await roles()).toBe("owner");
  });

  it("an MD5 password, which a rename would clear: refused, nothing changed", async () => {
    // An old volume: MD5 stored, and the md5 method that still accepts it.
    inContainer("sed -i 's/scram-sha-256$/md5/' \"$PGDATA/pg_hba.conf\"");
    inContainer(
      `psql -q -U ${OWNER_ROLE} -d cenacle -c "SET password_encryption = 'md5'" -c "ALTER ROLE ${OWNER_ROLE} PASSWORD '${P0}'" -c "SELECT pg_reload_conf()"`,
    );
    try {
      await expect(switchOwner(cluster, { current: P0, next: P1, temp: draw() })).rejects.toThrow(
        /not SCRAM/,
      );
      expect(await roles()).toBe("owner");
    } finally {
      inContainer("sed -i 's/md5$/scram-sha-256/' \"$PGDATA/pg_hba.conf\"");
      inContainer(
        `psql -q -U ${OWNER_ROLE} -d cenacle -c "ALTER ROLE ${OWNER_ROLE} PASSWORD '${P0}'" -c "SELECT pg_reload_conf()"`,
      );
    }
  });
});

describe("a switch that fails midway changes nothing", () => {
  it("rolled back whole, the temporary superuser dropped, the test database kept", async () => {
    const failing = async () => {
      throw new Error("cut short");
    };
    await expect(
      switchOwner(cluster, { current: P0, next: P1, temp: draw() }, { beforeCommit: failing }),
    ).rejects.toThrow(NothingChanged);
    await withSql(OWNER_ROLE, P0, async (sql) => {
      expect(await ownerState(sql)).toBe("before");
      const left =
        await sql`select rolname from pg_roles where rolname in (${ADMIN_ROLE}, ${SWITCH_ROLE})`;
      expect(left).toEqual([]);
      expect(await ownedLeft(sql, OWNER_ROLE)).toBeGreaterThan(10);
      expect(await sql`select 1 from pg_database where datname = 'cenacle_test'`).toHaveLength(1);
    });
  });
});

describe("a program holding a lock", () => {
  it("does not hold the switch for long: refused after 5 s, rolled back, said", async () => {
    const app = as("cenacle_app", APP);
    try {
      const started = Date.now();
      const failure = await app.begin(async (tx) => {
        await tx`select count(*) from events`; // holds a lock on events till the end
        return switchOwner(cluster, { current: P0, next: P1, temp: draw() }).catch((e) => e);
      });
      expect(failure).toBeInstanceOf(NothingChanged);
      expect(String(failure)).toMatch(/lock/);
      expect(Date.now() - started).toBeLessThan(20_000);
    } finally {
      await app.end();
    }
    expect(await roles()).toBe("owner");
    await withSql(OWNER_ROLE, P0, async (sql) => {
      expect(await sql`select rolname from pg_roles where rolname = ${SWITCH_ROLE}`).toEqual([]);
    });
  }, 30_000);
});

describe("the switch, then back", () => {
  it("renames the bootstrap role, which keeps its password, and gives everything to a new owner", async () => {
    const done = await switchOwner(cluster, { current: P0, next: P1, temp: draw() });
    expect(done.transferred).toBeGreaterThan(10);
    expect(done.testDropped).toBe(true);
    await withSql(ADMIN_ROLE, P0, async (sql) => {
      expect(await ownerState(sql)).toBe("done");
      expect(await ownedLeft(sql, ADMIN_ROLE)).toBe(0);
      expect(await sql`select rolname from pg_roles where rolname = ${SWITCH_ROLE}`).toEqual([]);
      const [db] =
        await sql`select pg_get_userbyid(datdba) as owner from pg_database where datname = 'cenacle'`;
      expect(db?.owner).toBe(OWNER_ROLE);
      expect(await sql`select 1 from pg_database where datname = 'cenacle_test'`).toEqual([]);
    });
    // The old password no longer opens the owner: only the admin.
    await expect(withSql(OWNER_ROLE, P0, (sql) => sql`select 1`)).rejects.toMatchObject({
      code: "28P01",
    });
  });

  it("the new owner is no superuser, and is refused the system", async () => {
    await withSql(OWNER_ROLE, P1, async (sql) => {
      const [me] = await sql`select rolsuper, oid::int from pg_roles where rolname = current_user`;
      expect(me).toMatchObject({ rolsuper: false });
      expect(me?.oid).not.toBe(10);
      for (const statement of [
        "COPY (select 1) TO PROGRAM 'id'",
        "select pg_read_file('/etc/passwd')",
      ]) {
        expect(await sql.unsafe(statement).then(() => "ok", code)).toBe("42501");
      }
    });
  });

  it("the programs carry on: the app reads its rows, writes, and purges through the owner's function", async () => {
    await withSql("cenacle_app", APP, async (sql) => {
      expect(await sql`select count(*)::int as n from events where agent = 'bascule'`).toEqual([
        { n: 1 },
      ]);
      await sql`insert into events (agent, type, payload) values ('bascule', 'heartbeat', '{}')`;
      await sql`select purge_events(now() - interval '400 days')`;
    });
  });

  it("the new owner migrates, twice, and recreates the test database while the app is connected", async () => {
    for (let i = 0; i < 2; i++) {
      await migrate({
        ownerUrl: url(OWNER_ROLE, P1),
        appPassword: APP,
        executorPassword: EXECUTOR,
      });
    }
    await withSql(OWNER_ROLE, P1, async (sql) => {
      await sql.unsafe("CREATE DATABASE cenacle_test");
      const app = as("cenacle_app", APP, "cenacle_test");
      await app`select 1`.catch(() => {}); // CONNECT may be refused: then nothing holds it
      await sql.unsafe("DROP DATABASE cenacle_test WITH (FORCE)");
      await app.end({ timeout: 1 }).catch(() => {});
    });
  });

  it("a second switch is refused, and so is a switch back with a wrong password", async () => {
    await expect(switchOwner(cluster, { current: P1, next: draw(), temp: draw() })).rejects.toThrow(
      "already done",
    );
    await expect(switchBack(cluster, { admin: P1, temp: draw() })).rejects.toThrow();
    expect(await roles()).toBe("admin");
  });

  it("back as before: the bootstrap role is cenacle_owner again, with its password, owning everything", async () => {
    await switchBack(cluster, { admin: P0, temp: draw() });
    await withSql(OWNER_ROLE, P0, async (sql) => {
      expect(await ownerState(sql)).toBe("before");
      expect(await ownedLeft(sql, OWNER_ROLE)).toBeGreaterThan(10);
      expect(
        await sql`select rolname from pg_roles where rolname in (${ADMIN_ROLE}, ${SWITCH_ROLE})`,
      ).toEqual([]);
    });
    await expect(withSql(OWNER_ROLE, P1, (sql) => sql`select 1`)).rejects.toMatchObject({
      code: "28P01",
    });
    await migrate({ ownerUrl: url(OWNER_ROLE, P0), appPassword: APP, executorPassword: EXECUTOR });
    await withSql("cenacle_app", APP, async (sql) => {
      expect(await sql`select count(*)::int as n from events where agent = 'bascule'`).toEqual([
        { n: 2 },
      ]);
    });
  });

  it("and the switch can be made again after a way back", async () => {
    const again = await switchOwner(cluster, { current: P0, next: draw(), temp: draw() });
    expect(again.transferred).toBeGreaterThan(10);
    expect(await roles()).toBe("admin");
  });
});
