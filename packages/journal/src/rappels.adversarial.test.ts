// The reminders' table (ADR-0041), in the real database: set, listed,
// cancelled for real; due ones oldest first; marked rung once, never before
// they were set; purged only once rung, never while still due. The table
// refuses what does not hold, and the application role may change nothing
// but the instant a reminder rang.
import { afterAll, describe, expect, it } from "vitest";
import { createRappelStore, MAX_REMINDER_TEXT, RappelError } from "./rappels.ts";
import { appConnection } from "./test-db.ts";

const sql = appConnection();
afterAll(async () => {
  await sql.end();
});
const store = createRappelStore(sql);
/** Far from today, so that these rows are told apart from any other. */
const at = (minutes: number) => new Date(Date.UTC(2031, 0, 1) + minutes * 60_000);
const exists = async (id: number) =>
  ((await sql`select count(*)::int as n from rappels where id = ${id}`)[0]?.n ?? 0) === 1;

describe("set, listed, cancelled", () => {
  it("a reminder is kept as typed, and comes back among the ones to come", async () => {
    const r = await store.add("  appeler le garage  ", at(10));
    expect(r.text).toBe("appeler le garage");
    expect(r.due).toEqual(at(10));
    expect(r.rangAt).toBeNull();
    expect((await store.upcoming(100)).map((x) => x.id)).toContain(r.id);
  });

  it("cancelled: erased for real, and a second cancel finds nothing", async () => {
    const r = await store.add("x", at(20));
    expect(await store.cancel(r.id)).toBe(true);
    expect(await store.cancel(r.id)).toBe(false);
    expect(await exists(r.id)).toBe(false);
  });

  it("one that rang cannot be cancelled (it is history, purged in its time)", async () => {
    const r = await store.add("x", at(30));
    expect(await store.markRang(r.id, new Date())).toBe(true);
    expect(await store.cancel(r.id)).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN])("cancel(%s): false", async (id) => {
    expect(await store.cancel(id)).toBe(false);
  });
});

describe("the bell's side", () => {
  it("due: only those due and not rung, oldest first", async () => {
    const a = await store.add("a", at(100));
    const b = await store.add("b", at(90));
    const c = await store.add("c", at(200));
    const due = (await store.due(at(150), 100)).map((r) => r.id);
    expect(due).toContain(a.id);
    expect(due.indexOf(b.id)).toBeLessThan(due.indexOf(a.id));
    expect(due).not.toContain(c.id);
  });

  it("marked rung once: the second mark is refused, and it is no longer due", async () => {
    const r = await store.add("x", at(300));
    expect(await store.markRang(r.id, new Date())).toBe(true);
    expect(await store.markRang(r.id, new Date())).toBe(false);
    expect((await store.due(at(400), 100)).map((x) => x.id)).not.toContain(r.id);
  });

  it("a clock behind the database's: never rung before it was set", async () => {
    const r = await store.add("x", at(310));
    expect(await store.markRang(r.id, new Date(Date.now() - 3_600_000))).toBe(true);
    const [row] = await sql`select sonne_le >= pose_le as ok from rappels where id = ${r.id}`;
    expect(row?.ok).toBe(true);
  });
});

describe("the purge", () => {
  it("erases what rang before the cutoff, never one still due, however old", async () => {
    const rung = await store.add("rung", at(-500_000));
    const due = await store.add("due", at(-500_000));
    await store.markRang(rung.id, new Date());
    // A cutoff an hour ago: what rang just now is kept.
    await store.purge(new Date(Date.now() - 3_600_000));
    expect(await exists(rung.id)).toBe(true);
    // A cutoff an hour ahead: what rang is erased; what is still due, never.
    await store.purge(new Date(Date.now() + 3_600_000));
    expect(await exists(rung.id)).toBe(false);
    expect(await exists(due.id)).toBe(true);
  });
});

describe("refused", () => {
  it.each([
    ["empty", "   "],
    ["too long", "x".repeat(MAX_REMINDER_TEXT + 1)],
    ["two lines", "a\nb"],
    ["a tab", "a\tb"],
    ["an escape", "a\u001b[31mb"],
    ["a C1 control", "a\u0085b"],
    ["a line separator", "a\u2028b"],
    ["nothing but zero widths", "\u200b\u200b"],
    ["nothing but a direction mark", "\u202e"],
    ["301 emojis", "🔔".repeat(301)],
  ])("a text %s: refused before the database", async (_what, text) => {
    await expect(store.add(text, at(1))).rejects.toThrow(RappelError);
  });

  it("300 emojis are 300 characters: kept, as the table counts them", async () => {
    const r = await store.add("🔔".repeat(300), at(700));
    expect([...r.text]).toHaveLength(300);
  });

  it("the table itself refuses a control character or an empty text", async () => {
    await expect(
      sql`insert into rappels (texte, echeance) values (${"a\nb"}, ${at(1)})`,
    ).rejects.toThrow();
    await expect(
      sql`insert into rappels (texte, echeance) values (${""}, ${at(1)})`,
    ).rejects.toThrow();
  });

  it("the application role changes nothing but the instant it rang", async () => {
    const r = await store.add("x", at(600));
    await expect(sql`update rappels set texte = 'y' where id = ${r.id}`).rejects.toThrow();
    await expect(sql`update rappels set echeance = now() where id = ${r.id}`).rejects.toThrow();
    await expect(sql`update rappels set pose_le = now() where id = ${r.id}`).rejects.toThrow();
  });
});
