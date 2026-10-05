import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createMailStore } from "./mail-store.ts";
import { appConnection } from "./test-db.ts";

const sql = appConnection();
const store = createMailStore(sql);
afterAll(() => sql.end());
beforeEach(async () => {
  await store.forget("inbox");
  await store.forget("sent");
});

const K = (c: string) => c.repeat(64);
const inbox = (uid: number, at = "2026-09-30T08:00:00.000Z") => ({
  uid,
  receivedAt: at,
  noFollowUp: uid === 3,
  urgentTerm: uid % 10 === 2,
  senderAuthenticated: true,
  senderKey: K("a"),
  messageKey: K(String(uid % 10)),
  threadKeys: [K("f")],
});

describe("mail store", () => {
  it("remembers new mails once, and where the pass stopped", async () => {
    expect(await store.saveInbox("7", [inbox(1), inbox(2)])).toBe(2);
    expect(await store.saveInbox("7", [inbox(2), inbox(3)])).toBe(1);
    expect(await store.position("inbox")).toEqual({ uidValidity: "7", lastUid: 3 });
    expect(await store.position("sent")).toBeNull();
  });

  it("sets a category once, and counts per category", async () => {
    await store.saveInbox("7", [inbox(1), inbox(2), inbox(3)]);
    expect(await store.categorize(1, "bruit", "rule")).toBe(true);
    expect(await store.categorize(1, "clients_prospects", "model")).toBe(false);
    expect(await store.uncategorized()).toEqual([2, 3]);
    expect(await store.totals()).toEqual({
      clients_prospects: 0,
      administratif: 0,
      bruit: 1,
      a_trier: 0,
      pending: 2,
    });
  });

  it("reads back sent mails with their keys", async () => {
    await store.saveSent("9", [
      {
        uid: 4,
        sentAt: "2026-09-30T09:00:00.000Z",
        recipientKeys: [K("b")],
        messageKey: K("c"),
        threadKeys: [],
      },
    ]);
    expect(await store.sent()).toEqual([
      {
        uid: 4,
        sentAt: "2026-09-30T09:00:00.000Z",
        recipientKeys: [K("b")],
        messageKey: K("c"),
        threadKeys: [],
      },
    ]);
  });

  it("purges what is older than the retention cutoff", async () => {
    await store.saveInbox("7", [inbox(1, "2026-06-01T00:00:00.000Z"), inbox(2)]);
    expect(await store.purgeBefore(new Date("2026-07-01T00:00:00Z"))).toBe(1);
    expect((await store.inbox()).map((i) => i.uid)).toEqual([2]);
  });

  it("keeps the no-follow-up flag decided at collection time", async () => {
    await store.saveInbox("7", [inbox(1), inbox(3)]);
    expect((await store.inbox()).map((i) => [i.uid, i.noFollowUp])).toEqual([
      [1, false],
      [3, true],
    ]);
  });

  it("forgets mails that left the server, and only those", async () => {
    await store.saveInbox("7", [inbox(1), inbox(2), inbox(3)]);
    expect(await store.keepOnly("inbox", [1, 3])).toBe(1);
    expect((await store.inbox()).map((i) => i.uid)).toEqual([1, 3]);
    expect(await store.keepOnly("inbox", [])).toBe(2);
  });

  it("lists urgent client mails not notified yet, recent ones only, then forgets them", async () => {
    await store.saveInbox("7", [inbox(1), inbox(2), inbox(2 + 10, "2026-01-01T00:00:00.000Z")]);
    await store.categorize(2, "clients_prospects", "rule");
    await store.categorize(1, "clients_prospects", "rule");
    await store.categorize(12, "clients_prospects", "rule"); // urgent, but too old
    const since = new Date("2026-09-29T00:00:00Z");
    expect(await store.urgentToNotify(since)).toEqual([2]);
    await store.markUrgentNotified([2]);
    expect(await store.urgentToNotify(since)).toEqual([]);
  });

  it("does not list an urgent term outside the client category", async () => {
    await store.saveInbox("7", [inbox(2)]);
    await store.categorize(2, "bruit", "rule");
    expect(await store.urgentToNotify(new Date(0))).toEqual([]);
  });
});
