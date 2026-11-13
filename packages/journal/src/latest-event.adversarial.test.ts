// latestEvent (lot F3, 13/11): the latest event of an agent among some types,
// in one row — the same answer reading the whole journal gave, never another
// agent's, never a type not asked for. In the real test database.
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { createJournal, latestEvent, readAllEvents } from "./journal.ts";
import { ownerUrlFromEnv } from "./migrate.ts";
import { appConnection, TEST_DB } from "./test-db.ts";

const sql = appConnection();
const journal = createJournal(sql);
afterAll(async () => {
  await sql.end();
});

describe("latestEvent", () => {
  it("the latest of the types asked, for that agent only — as reading everything said", async () => {
    const agent = `f3-${process.pid}`;
    await journal.append({ agent, type: "notify.failed", payload: { kind: "a" } });
    await journal.append({ agent, type: "mail.fetched", payload: { count: 1 } });
    await journal.append({ agent, type: "notify.recovered", payload: { minutes: 3 } });
    await journal.append({ agent: `${agent}-other`, type: "notify.failed", payload: {} });
    await journal.append({ agent, type: "heartbeat", payload: {} });
    const types = ["notify.failed", "notify.recovered"];
    const got = await latestEvent(sql, agent, types);
    const all = (await readAllEvents(journal, agent)).filter((e) => types.includes(e.type));
    expect(got).toEqual(all.at(-1));
    expect(got?.type).toBe("notify.recovered");
    expect(await latestEvent(sql, agent, ["recap.sent"])).toBeUndefined();
    expect(await latestEvent(sql, agent, [])).toBeUndefined();
  });

  it('ids that cross a power of ten: the number decides, never the text ("998" > "16840")', async () => {
    const owner = postgres(ownerUrlFromEnv(TEST_DB), { infer: true, max: 1, onnotice: () => {} });
    try {
      const agent = `f3-digits-${process.pid}`;
      // Just under the next power of ten above every id there: the next four
      // ids cross it (…98, …99, then one more digit), never one already taken.
      const [row] = await owner<{ max: string | null }[]>`select max(id)::text as max from events`;
      const ten = 10n ** BigInt(String(BigInt(row?.max ?? "0") + 4n).length);
      await owner.unsafe(`select setval(pg_get_serial_sequence('events', 'id'), ${ten - 3n})`);
      for (let i = 0; i < 4; i++) {
        await journal.append({ agent, type: "mail.fetched", payload: { count: i } });
      }
      const got = await latestEvent(sql, agent, ["mail.fetched"]);
      expect(got?.payload).toEqual({ count: 3 });
      expect(got?.id).toBeGreaterThanOrEqual(ten);
    } finally {
      await owner.end();
    }
  });

  it("its index is there: (agent, type, id), so a type never seen is not a scan (034)", async () => {
    const rows = await sql<{ def: string }[]>`
      select indexdef as def from pg_indexes where tablename = 'events' and indexname = 'events_agent_type_id'`;
    expect(rows[0]?.def).toMatch(/\(agent, type, id\)/);
  });

  it("a type looking like SQL is only a value", async () => {
    expect(await latestEvent(sql, "iris", ["x' or '1'='1"])).toBeUndefined();
  });
});
