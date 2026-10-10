// latestEventAt (J6): the newest event of an agent and type, filtered by
// payload fields if asked — never another agent's, null when there is none.
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createJournal, latestEventAt } from "./journal.ts";
import { appConnection } from "./test-db.ts";

const sql = appConnection();
afterAll(async () => {
  await sql.end();
});
const journal = createJournal(sql);
const type = `test.latest_${randomBytes(3).toString("hex")}`;

describe("latestEventAt", () => {
  it("none yet: null", async () => {
    expect(await latestEventAt(sql, "securite", type)).toBeNull();
  });

  it("the newest of this agent and type; a payload filter narrows it", async () => {
    const a = await journal.append({ agent: "securite", type, payload: { network: true } });
    const b = await journal.append({ agent: "securite", type, payload: { network: false } });
    await journal.append({ agent: "iris", type, payload: { network: true } });
    expect((await latestEventAt(sql, "securite", type))?.getTime()).toBe(b.occurredAt.getTime());
    expect((await latestEventAt(sql, "securite", type, { network: true }))?.getTime()).toBe(
      a.occurredAt.getTime(),
    );
    expect(await latestEventAt(sql, "cto", type)).toBeNull();
  });
});
