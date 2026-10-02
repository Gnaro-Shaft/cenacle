import { afterAll, describe, expect, it } from "vitest";
import { createJournal } from "./journal.ts";
import { appConnection } from "./test-db.ts";

const sql = appConnection();
const journal = createJournal(sql);
afterAll(() => sql.end());

describe("journal", () => {
  it("appends an event and returns it with an id and a timestamp", async () => {
    const event = await journal.append({
      agent: "iris",
      type: "state.changed",
      payload: { to: "reading" },
    });
    expect(event.id).toBeTypeOf("bigint");
    expect(event.occurredAt).toBeInstanceOf(Date);
    expect(event.payload).toEqual({ to: "reading" });
  });

  it("defaults the payload to an empty object", async () => {
    const event = await journal.append({ agent: "iris", type: "heartbeat" });
    expect(event.payload).toEqual({});
  });

  it("reads events in insertion order, after a given id, filtered by agent", async () => {
    const first = await journal.append({ agent: "argos", type: "probe.ok" });
    await journal.append({ agent: "iris", type: "state.changed", payload: { to: "idle" } });
    await journal.append({ agent: "argos", type: "probe.failed" });
    const events = await journal.read({ agent: "argos", afterId: first.id - 1n });
    expect(events.map((e) => e.type)).toEqual(["probe.ok", "probe.failed"]);
    expect(events[0]?.id).toBeLessThan(events[1]?.id ?? 0n);
  });

  it("honours the limit", async () => {
    const events = await journal.read({ limit: 2 });
    expect(events).toHaveLength(2);
  });
});

describe("readAllEvents", () => {
  it("reads beyond one page", async () => {
    const { readAllEvents } = await import("./journal.ts");
    const rows = Array.from({ length: 1005 }, () => sql`('paging', 'heartbeat')`);
    await sql`insert into events (agent, type) values ${rows.reduce((a, b) => sql`${a}, ${b}`)}`;
    expect(await readAllEvents(journal, "paging")).toHaveLength(1005);
  });
});
