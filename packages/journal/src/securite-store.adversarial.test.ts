// The security agent's findings in the real database: one active finding per
// (type, target, occurrence); a candidate opens only when promoted, never
// when merely seen again (too soon, by the 10-minute rule);
// "signaled" only when marked after sending; a resolved finding is told only
// if it had been told open; accepting needs an open finding and a reason;
// the purge keeps what is open and asks an accepted risk again after 90 days.
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createSecuriteStore, type SeenFinding } from "./securite-store.ts";
import { appConnection } from "./test-db.ts";

const sql = appConnection();
afterAll(async () => {
  await sql.end();
});
const store = createSecuriteStore(sql);
const DAY = 24 * 3_600_000;
const T0 = new Date("2026-10-10T05:30:00Z");
const run = randomBytes(4).toString("hex");
const seen = (n: number, over: Partial<SeenFinding> = {}): SeenFinding => ({
  check: "tailscale",
  type: "tailscale_outdated",
  target: `t-${run}-${n}`,
  occurrence: "1.0.0",
  severity: "moyen",
  title: `Constat ${n}`,
  params: { label: "x" },
  ...over,
});
const empty = { insert: [], promote: [], touch: [], resolve: [], drop: [] };
const mine = async (n: number) =>
  (await store.active()).find((f) => f.target === `t-${run}-${n}`) ?? null;

describe("the findings store", () => {
  it("a candidate, then open on its second sighting; told only once marked", async () => {
    await store.apply({ ...empty, insert: [seen(1)] }, T0);
    const c = await mine(1);
    expect(c).toMatchObject({ status: "candidat", params: { label: "x" } });
    expect((await store.toSignal()).opened.map((f) => f.id)).not.toContain(c?.id);
    await store.apply(
      { ...empty, promote: [{ id: c?.id ?? 0, seen: seen(1, { severity: "eleve" }) }] },
      new Date(T0.getTime() + DAY),
    );
    expect(await mine(1)).toMatchObject({ status: "ouvert", severity: "eleve" });
    expect((await store.toSignal()).opened.map((f) => f.id)).toContain(c?.id);
    await store.markSignaled([c?.id ?? 0], []);
    expect((await store.toSignal()).opened.map((f) => f.id)).not.toContain(c?.id);
  });

  it("a candidate seen again too soon (touched): still a candidate, never told", async () => {
    await store.apply({ ...empty, insert: [seen(9)] }, T0);
    const c = await mine(9);
    await store.apply({ ...empty, touch: [{ id: c?.id ?? 0, seen: seen(9) }] }, T0);
    expect(await mine(9)).toMatchObject({ status: "candidat" });
    expect((await store.toSignal()).opened.map((f) => f.id)).not.toContain(c?.id);
    await store.apply({ ...empty, promote: [{ id: c?.id ?? 0, seen: seen(9) }] }, T0);
    expect(await mine(9)).toMatchObject({ status: "ouvert" });
  });

  it("an advisory out of the feed expires quietly: caduc, never told resolved (J6e3)", async () => {
    await store.apply({ ...empty, insert: [seen(10), seen(11)] }, T0);
    const [a, b] = [await mine(10), await mine(11)];
    await store.apply(
      { ...empty, promote: [a, b].map((f) => ({ id: f?.id ?? 0, seen: seen(0) })) },
      T0,
    );
    await store.markSignaled([a?.id ?? 0], []);
    await store.apply({ ...empty, expire: [a?.id ?? 0, b?.id ?? 0] }, T0);
    const [row] = await sql<
      { status: string }[]
    >`select status from securite_constats where id = ${a?.id ?? 0}`;
    expect(row?.status).toBe("caduc");
    expect((await store.toSignal()).resolved.map((f) => f.id)).not.toContain(a?.id);
  });

  it("one active finding per key, enforced by the database", async () => {
    await store.apply({ ...empty, insert: [seen(2)] }, T0);
    await expect(store.apply({ ...empty, insert: [seen(2)] }, T0)).rejects.toThrow();
  });

  it("resolved is told only if it had been told open", async () => {
    await store.apply({ ...empty, insert: [seen(3), seen(4)] }, T0);
    const [a, b] = [await mine(3), await mine(4)];
    await store.apply(
      { ...empty, promote: [a, b].map((f) => ({ id: f?.id ?? 0, seen: seen(0) })) },
      T0,
    );
    await store.markSignaled([a?.id ?? 0], []);
    await store.apply({ ...empty, resolve: [a?.id ?? 0, b?.id ?? 0] }, T0);
    const resolved = (await store.toSignal()).resolved.map((f) => f.id);
    expect(resolved).toContain(a?.id);
    expect(resolved).not.toContain(b?.id);
  });

  it("accepting: an open finding and a reason; a candidate or no reason is refused", async () => {
    await store.apply({ ...empty, insert: [seen(5)] }, T0);
    const f = await mine(5);
    expect(await store.accept(f?.id ?? 0, "plus tard", T0)).toBe(false);
    await store.apply({ ...empty, promote: [{ id: f?.id ?? 0, seen: seen(5) }] }, T0);
    await expect(store.accept(f?.id ?? 0, "  x ", T0)).rejects.toThrow(/reason/);
    expect(await store.accept(f?.id ?? 0, "mise à jour  vendredi", T0)).toBe(true);
    expect(await mine(5)).toMatchObject({ status: "accepte", reason: "mise à jour vendredi" });
    expect(await store.accept(f?.id ?? 0, "encore", T0)).toBe(false);
  });

  it("the purge: open is kept; closed after 365 days; accepted asked again after 90", async () => {
    await store.apply({ ...empty, insert: [seen(6), seen(7), seen(8)] }, T0);
    const [o, c, a] = [await mine(6), await mine(7), await mine(8)];
    await store.apply(
      {
        ...empty,
        promote: [o, a].map((f) => ({ id: f?.id ?? 0, seen: seen(0) })),
        drop: [c?.id ?? 0],
      },
      T0,
    );
    await store.accept(a?.id ?? 0, "risque pris", T0);
    await store.purge(new Date(T0.getTime() + 91 * DAY));
    expect(await mine(6)).not.toBeNull();
    expect(await mine(8)).toBeNull();
    const closed = await sql`select 1 from securite_constats where id = ${c?.id ?? 0}`;
    expect(closed.length).toBe(1);
    await store.purge(new Date(T0.getTime() + 366 * DAY));
    expect((await sql`select 1 from securite_constats where id = ${c?.id ?? 0}`).length).toBe(0);
    expect(await mine(6)).not.toBeNull();
  });

  it.each([
    ["an unknown severity", { severity: "grave" as never }],
    ["a type that is not a word", { type: "drop table" }],
    ["an empty title", { title: "" }],
  ])("refuses %s", async (_, over) => {
    await expect(
      store.apply({ ...empty, insert: [seen(50 + Math.floor(Math.random() * 1e6), over)] }, T0),
    ).rejects.toThrow();
  });
});
