import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLocationStore, VIRTUAL_UID_VALIDITY } from "./mail-locations.ts";
import { createMailStore } from "./mail-store.ts";
import { appConnection } from "./test-db.ts";

// The test database (cenacle_test), recreated for each run — never Iris's own.
const sql = appConnection();
const locations = createLocationStore(sql);
const mails = createMailStore(sql);
afterAll(() => sql.end());
beforeEach(async () => {
  await mails.forget("inbox");
  await locations.keepOnly([]);
  await locations.keepCursors([]);
});

const K = (c: string) => c.repeat(64);
const at = (uid: number) => ({ folderKey: K("a"), uidValidity: "7", uid });
const remember = (id: number) =>
  mails.saveInbox(VIRTUAL_UID_VALIDITY, [
    {
      uid: id,
      receivedAt: "2026-10-06T08:00:00.000Z",
      noFollowUp: false,
      urgentTerm: false,
      senderAuthenticated: true,
      senderKey: K("b"),
      messageKey: K("c"),
      threadKeys: [],
    },
  ]);

describe("mail locations (ADR-0016)", () => {
  it("adds, locates and moves a mail; its id stays", async () => {
    const id = await locations.add(at(3), K("c"));
    await locations.move(id, { folderKey: K("d"), uidValidity: "9", uid: 1 });
    expect((await locations.locate([id])).get(id)).toEqual({
      id,
      folderKey: K("d"),
      uidValidity: "9",
      uid: 1,
      messageKey: K("c"),
    });
  });

  it("one place holds one mail", async () => {
    await locations.add(at(3), null);
    await expect(locations.add(at(3), null)).rejects.toThrow();
  });

  it("an id is never reused, even after its mail is gone", async () => {
    const first = await locations.add(at(1), null);
    await locations.keepOnly([]);
    expect(await locations.add(at(1), null)).toBeGreaterThan(first);
  });

  it("erasing a remembered mail erases its location, in the same transaction", async () => {
    const id = await locations.add(at(1), K("c"));
    await remember(id);
    await mails.keepOnly("inbox", []);
    expect(await locations.locate([id])).toEqual(new Map());
  });

  it("refuses a folder name instead of a key, and a malformed place", async () => {
    await expect(
      locations.add({ folderKey: "INBOX", uidValidity: "7", uid: 1 }, null),
    ).rejects.toThrow();
    await expect(locations.add({ ...at(1), uid: 0 }, null)).rejects.toThrow();
    await expect(
      locations.setCursor("Clients", { uidValidity: "1", lastUid: 0 }),
    ).rejects.toThrow();
  });

  it("cursors: one per folder, updated, dropped when the folder is gone", async () => {
    await locations.setCursor(K("a"), { uidValidity: "1", lastUid: 5 });
    await locations.setCursor(K("a"), { uidValidity: "2", lastUid: 7 });
    await locations.setCursor(K("e"), { uidValidity: "1", lastUid: 1 });
    expect(await locations.cursor(K("a"))).toEqual({ uidValidity: "2", lastUid: 7 });
    expect(await locations.keepCursors([K("a")])).toBe(1);
    expect(await locations.cursor(K("e"))).toBeNull();
  });
});
