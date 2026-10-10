// The opposition list's retention (T-07, decided on 2026-10-10): a key leaves
// `opposition_jours` after the person's LAST trace — their request, or the
// latest mail met from or to them. A recent mail keeps an old request; a mail
// dated in the future never makes a key eternal; only stale keys leave; the
// backup keeps the trace; and the app role can move the trace, nothing else.
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createPeople } from "./people.ts";
import { createPurges } from "./purges.ts";
import { appConnection } from "./test-db.ts";

const sql = appConnection();
afterAll(async () => {
  await sql.end();
});
const people = createPeople(sql);
const purges = createPurges(sql);
const DAY = 24 * 3600 * 1000;
let n = Math.floor(Math.random() * 1e9);
const key = () => createHash("sha256").update(`opp${n++}`).digest("hex");
const daysAgo = (d: number) => new Date(Date.now() - d * DAY);
const row = async (k: string) => (await people.opposition()).find((e) => e.key === k) ?? null;

/** On the list since `requestDaysAgo`, as a restored backup would put it. */
async function opposed(requestDaysAgo: number, lastSeenDaysAgo: number | null = null) {
  const k = key();
  await people.restoreOpposition([
    {
      key: k,
      since: daysAgo(requestDaysAgo).toISOString(),
      lastSeen: lastSeenDaysAgo === null ? null : daysAgo(lastSeenDaysAgo).toISOString(),
    },
  ]);
  return k;
}

describe("the opposition list's last trace", () => {
  it("a mail met moves the trace to its date; an older mail never moves it back", async () => {
    const k = await opposed(10);
    await people.touch(new Map([[k, daysAgo(3)]]));
    const first = (await row(k))?.lastSeen ?? null;
    expect(first).not.toBeNull();
    await people.touch(new Map([[k, daysAgo(8)]]));
    expect((await row(k))?.lastSeen).toBe(first);
  });

  it("a mail dated in the future counts as now: it cannot make a key eternal", async () => {
    const k = await opposed(10);
    await people.touch(new Map([[k, new Date(Date.now() + 3650 * DAY)]]));
    const seen = Date.parse((await row(k))?.lastSeen ?? "");
    expect(seen).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("a key not on the list is never added by a trace", async () => {
    const stranger = key();
    await people.touch(new Map([[stranger, daysAgo(1)]]));
    expect(await row(stranger)).toBeNull();
  });

  it("a malformed key is refused, an invalid date ignored", async () => {
    await expect(people.touch(new Map([["not-a-key", daysAgo(1)]]))).rejects.toThrow(/not a key/);
    const k = await opposed(10);
    await people.touch(new Map([[k, new Date("nope")]]));
    expect((await row(k))?.lastSeen).toBeNull();
  });
});

describe("the opposition purge", () => {
  const cutoff = () => daysAgo(1095);

  it("an old request but a recent mail: the key stays", async () => {
    const k = await opposed(2000, 100);
    await purges.opposition(cutoff());
    expect(await row(k)).not.toBeNull();
  });

  it("an old request and no mail since, or an old one: the key leaves — and only it", async () => {
    const stale = await opposed(2000);
    const staleSeen = await opposed(2000, 1200);
    const fresh = await opposed(30);
    const removed = await purges.opposition(cutoff());
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(await row(stale)).toBeNull();
    expect(await row(staleSeen)).toBeNull();
    expect(await row(fresh)).not.toBeNull();
  });

  it("a key whose trace just moved survives the purge that would have taken it", async () => {
    const k = await opposed(2000);
    await people.touch(new Map([[k, daysAgo(1)]]));
    await purges.opposition(cutoff());
    expect(await row(k)).not.toBeNull();
  });
});

describe("the backup keeps the trace", () => {
  it("restored with its trace; an older backup without one is accepted", async () => {
    const k = await opposed(400, 20);
    const entry = await row(k);
    expect(entry?.lastSeen).not.toBeNull();
    const old = key();
    await people.restoreOpposition([{ key: old, since: daysAgo(5).toISOString() }]);
    expect((await row(old))?.lastSeen).toBeNull();
    await expect(
      people.restoreOpposition([{ key: key(), since: daysAgo(5).toISOString(), lastSeen: "nope" }]),
    ).rejects.toThrow(/invalid last trace/);
  });
});

describe("the application role's rights on the list", () => {
  it("may move the trace, never the key nor the date of the request", async () => {
    const k = await opposed(10);
    await expect(sql`update opposed_keys set since = now() where key = ${k}`).rejects.toThrow(
      /permission denied/,
    );
    await expect(sql`update opposed_keys set key = ${key()} where key = ${k}`).rejects.toThrow(
      /permission denied/,
    );
  });
});
