import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createJournal, InvalidEventError, MAX_PAYLOAD_BYTES } from "./journal.js";
import { appConnection } from "./test-db.js";

// The journal must survive a buggy or manipulated caller: history cannot
// be rewritten, not even by the application's own database role.
const sql = appConnection();
const journal = createJournal(sql);
let id = "0";

beforeAll(async () => {
  const event = await journal.append({
    agent: "iris",
    type: "state.changed",
    payload: { to: "idle" },
  });
  id = event.id.toString();
});
afterAll(() => sql.end());

describe("the database refuses to rewrite history", () => {
  it("refuses UPDATE", async () => {
    await expect(sql`update events set type = 'tampered' where id = ${id}`).rejects.toThrow();
  });

  it("refuses DELETE", async () => {
    await expect(sql`delete from events where id = ${id}`).rejects.toThrow();
  });

  it("refuses TRUNCATE", async () => {
    await expect(sql`truncate events`).rejects.toThrow();
  });

  it("refuses disabling the triggers (the app role does not own the table)", async () => {
    await expect(sql`alter table events disable trigger all`).rejects.toThrow();
  });

  it("refuses dropping the table", async () => {
    await expect(sql`drop table events`).rejects.toThrow();
  });

  it("refuses choosing an event id", async () => {
    await expect(
      sql`insert into events (id, agent, type) values (1, 'iris', 'forged')`,
    ).rejects.toThrow();
  });

  it("still holds the original event, unchanged", async () => {
    const [row] = await sql`select type from events where id = ${id}`;
    expect(row?.type).toBe("state.changed");
  });
});

describe("the journal rejects malformed events before they reach the database", () => {
  it.each([
    ["an empty agent", { agent: "", type: "x" }],
    ["an uppercase agent", { agent: "Iris", type: "x" }],
    ["an SQL injection in the agent", { agent: "iris'; drop table events; --", type: "x" }],
    ["an over-long agent", { agent: `a${"b".repeat(40)}`, type: "x" }],
    ["a type with spaces", { agent: "iris", type: "state changed" }],
    ["a non-string agent", { agent: 42 as unknown as string, type: "x" }],
  ])("rejects %s", async (_label, event) => {
    await expect(journal.append(event)).rejects.toThrow(InvalidEventError);
  });

  it.each([
    ["an array", [1, 2]],
    ["a string", "hello"],
    ["null", null],
    ["a Date", new Date()],
  ])("rejects a payload that is %s", async (_label, payload) => {
    await expect(
      journal.append({ agent: "iris", type: "x", payload: payload as never }),
    ).rejects.toThrow(InvalidEventError);
  });

  it("rejects an oversized payload (events carry facts, not content)", async () => {
    const payload = { text: "x".repeat(MAX_PAYLOAD_BYTES) };
    await expect(journal.append({ agent: "iris", type: "x", payload })).rejects.toThrow(
      InvalidEventError,
    );
  });

  it.each([0, -1, 1.5, 1001])("rejects a read limit of %s", async (limit) => {
    await expect(journal.read({ limit })).rejects.toThrow(InvalidEventError);
  });

  it("rejects an injection attempt in the read filter", async () => {
    await expect(journal.read({ agent: "iris' or '1'='1" })).rejects.toThrow(InvalidEventError);
  });
});
