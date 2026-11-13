// The floors of the purges (032, charter rule 4): the database itself refuses
// a purge more recent than the cadre's retention — the journal cannot be
// emptied in one call, by anyone holding the application password. No floor,
// no purge. The application role can neither read, change, remove nor shadow
// a floor, nor call or replace the function that checks it. Only the owner
// sets them: whole days, both or neither.
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { createJournal } from "./journal.ts";
import { ownerUrlFromEnv } from "./migrate.ts";
import { setPurgeFloors } from "./purge-floors.ts";
import { createPurges, PurgeFloorError } from "./purges.ts";
import { appConnection, TEST_DB, TEST_FLOORS } from "./test-db.ts";

const sql = appConnection();
const owner = postgres(ownerUrlFromEnv(TEST_DB), { max: 1, onnotice: () => {} });
const purges = createPurges(sql);
const journal = createJournal(sql);
afterAll(async () => {
  await setPurgeFloors(TEST_FLOORS, TEST_DB);
  await Promise.all([sql.end(), owner.end()]);
});

// "Now", for a cutoff: a minute ago. The programs' clock may be some milliseconds
// ahead of the container's, and the instant itself would then read as the future.
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms);
const events = async () =>
  (await sql<{ n: number }[]>`select count(*)::int as n from events`)[0]?.n;
const floors = async () =>
  Object.fromEntries(
    (await owner<{ cle: string; jours: number }[]>`select cle, jours from purge_planchers`).map(
      (r) => [r.cle, r.jours],
    ),
  );

describe("a purge more recent than the retention is refused", () => {
  it("a minute ago, yesterday, one day short, two hours short: refused by name — and nothing is erased", async () => {
    await journal.append({ agent: "floortest", type: "kept.one" });
    const before = await events();
    for (const cutoff of [ago(MINUTE), ago(DAY), ago(179 * DAY), ago(180 * DAY - 2 * HOUR)]) {
      await expect(purges.events(cutoff)).rejects.toBeInstanceOf(PurgeFloorError);
    }
    for (const cutoff of [ago(MINUTE), ago(DAY), ago(89 * DAY), ago(90 * DAY - 2 * HOUR)]) {
      await expect(purges.proposals(cutoff)).rejects.toBeInstanceOf(PurgeFloorError);
    }
    expect(await events()).toBe(before);
  });

  it("the raw call any program holding the application password could make: refused too", async () => {
    const before = await events();
    await expect(sql`select purge_events(now())`).rejects.toMatchObject({ code: "PC001" });
    await expect(sql`select purge_proposals(now())`).rejects.toMatchObject({ code: "PC001" });
    await expect(sql`select purge_events(null::timestamptz)`).rejects.toMatchObject({
      code: "PC001",
    });
    await expect(sql`select purge_events('infinity'::timestamptz)`).rejects.toThrow(/future/);
    expect(await events()).toBe(before);
  });

  it("the refusal carries our own words, never the database's", async () => {
    const error = await purges.events(ago(MINUTE)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PurgeFloorError);
    expect((error as Error).name).toBe("PurgeFloorError");
    expect((error as Error).message).toMatch(/npm run db:migrate/);
  });

  it("the retention itself, and the hour of margin between two clocks: accepted", async () => {
    expect(await purges.events(ago(180 * DAY))).toBeGreaterThanOrEqual(0);
    expect(await purges.events(ago(180 * DAY - HOUR / 2))).toBeGreaterThanOrEqual(0);
    expect(await purges.proposals(ago(90 * DAY))).toBeGreaterThanOrEqual(0);
  });
});

describe("the floors are the owner's alone", () => {
  it("the application role cannot read, lower, add, remove or empty them", async () => {
    await expect(sql`select * from purge_planchers`).rejects.toThrow(/permission/);
    await expect(sql`update purge_planchers set jours = 1`).rejects.toThrow(/permission/);
    await expect(
      sql`insert into purge_planchers (cle, jours) values ('journal_jours', 1)
          on conflict (cle) do update set jours = 1`,
    ).rejects.toThrow(/permission/);
    await expect(sql`delete from purge_planchers`).rejects.toThrow(/permission/);
    await expect(sql`truncate purge_planchers`).rejects.toThrow(/permission/);
    await expect(sql`drop table purge_planchers`).rejects.toThrow(/owner/);
    expect(await floors()).toEqual({ journal_jours: 180, propositions_jours: 90 });
  });

  it("nor call, replace or drop the function that checks them", async () => {
    await expect(sql`select purge_floor_holds('journal_jours', now())`).rejects.toThrow(
      /permission/,
    );
    await expect(
      sql.unsafe(
        "create or replace function purge_floor_holds(la_cle text, cutoff timestamptz) returns void language sql as 'select'",
      ),
    ).rejects.toThrow(/owner|permission/);
    await expect(sql.unsafe("drop function purge_floor_holds(text, timestamptz)")).rejects.toThrow(
      /owner/,
    );
  });

  it("a temporary table of the same name does not become the floor", async () => {
    const before = await events();
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe("create temp table purge_planchers (cle text, jours integer)");
        await tx`insert into purge_planchers values ('journal_jours', 1), ('propositions_jours', 1)`;
        await tx`select purge_events(now() - interval '2 days')`;
      }),
    ).rejects.toMatchObject({ code: "PC001" });
    expect(await events()).toBe(before);
  });

  it("no floor set: every purge is refused, even the oldest", async () => {
    await owner`delete from purge_planchers`;
    try {
      const refused = await purges.events(ago(700 * DAY)).catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(PurgeFloorError);
      expect((refused as Error).message).toMatch(/holds no floor/);
      await expect(purges.proposals(ago(700 * DAY))).rejects.toBeInstanceOf(PurgeFloorError);
    } finally {
      await setPurgeFloors(TEST_FLOORS, TEST_DB);
    }
    expect(await purges.events(ago(700 * DAY))).toBeGreaterThanOrEqual(0);
  });
});

describe("setting the floors", () => {
  it.each([0, -1, 731, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "%s days: refused, nothing written",
    async (value) => {
      await expect(
        setPurgeFloors({ journalJours: value, propositionsJours: 90 }, TEST_DB),
      ).rejects.toThrow(/whole number of days/);
      expect(await floors()).toEqual({ journal_jours: 180, propositions_jours: 90 });
    },
  );

  it("both or neither: a bad second value leaves the first untouched", async () => {
    await expect(
      setPurgeFloors({ journalJours: 200, propositionsJours: 0 }, TEST_DB),
    ).rejects.toThrow(/propositions_jours/);
    expect(await floors()).toEqual({ journal_jours: 180, propositions_jours: 90 });
  });

  it("the owner changes a retention, and the purge follows the new floor", async () => {
    await setPurgeFloors({ journalJours: 10, propositionsJours: 5 }, TEST_DB);
    try {
      expect(await purges.events(ago(10 * DAY))).toBeGreaterThanOrEqual(0);
      await expect(purges.events(ago(9 * DAY))).rejects.toBeInstanceOf(PurgeFloorError);
      await expect(purges.proposals(ago(4 * DAY))).rejects.toBeInstanceOf(PurgeFloorError);
    } finally {
      await setPurgeFloors(TEST_FLOORS, TEST_DB);
    }
    await expect(purges.events(ago(10 * DAY))).rejects.toBeInstanceOf(PurgeFloorError);
  });

  it("set again with the same values: the date they were set does not move", async () => {
    const at = async () =>
      (await owner<{ pose_le: Date }[]>`select pose_le from purge_planchers order by cle`).map(
        (r) => r.pose_le.getTime(),
      );
    const before = await at();
    await setPurgeFloors(TEST_FLOORS, TEST_DB);
    expect(await at()).toEqual(before);
  });
});
