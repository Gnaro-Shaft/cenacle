// Reading a mail where it is now (ADR-0016): only Iris's own numbering names
// a mail; a mail in a folder Iris no longer reads, or not located, is gone.
import { describe, expect, it } from "vitest";
import { createKeyer } from "./keys.ts";
import { createLocator } from "./located.ts";
import { memoryLocationStore } from "./test-locations.ts";

const keyer = createKeyer("7".repeat(64));
const cadre = {} as never;

async function world(read = ["INBOX", "Clients"]) {
  const locations = memoryLocationStore();
  const a = await locations.add(
    { folderKey: keyer.folder("INBOX"), uidValidity: "5", uid: 10 },
    null,
  );
  const b = await locations.add(
    { folderKey: keyer.folder("Clients"), uidValidity: "8", uid: 3 },
    null,
  );
  const c = await locations.add(
    { folderKey: keyer.folder("Clients"), uidValidity: "8", uid: 4 },
    null,
  );
  const d = await locations.add(
    { folderKey: keyer.folder("Trash"), uidValidity: "1", uid: 1 },
    null,
  );
  const locator = createLocator({
    cadre,
    password: "pw",
    keyer,
    locations,
    folders: async () => read.map((path) => ({ path, key: keyer.folder(path) })),
  });
  return { locator, ids: { a, b, c, d } };
}

describe("createLocator", () => {
  it("groups mails by folder, with each server UID", async () => {
    const { locator, ids } = await world();
    const groups = await locator.groups([ids.a, ids.b, ids.c], "0");
    expect(groups.map((g) => [g.path, g.uidValidity, [...g.ids]])).toEqual([
      ["INBOX", "5", [[ids.a, 10]]],
      [
        "Clients",
        "8",
        [
          [ids.b, 3],
          [ids.c, 4],
        ],
      ],
    ]);
  });

  it("a mail in a folder Iris does not read (moved to Trash) is absent", async () => {
    const { locator, ids } = await world();
    expect(await locator.groups([ids.d], "0")).toEqual([]);
  });

  it("an id Iris does not know is absent", async () => {
    const { locator } = await world();
    expect(await locator.groups([999], "0")).toEqual([]);
  });

  it.each(["5", "1", "", "00"])("ids under another numbering (%j) name nothing", async (v) => {
    const { locator, ids } = await world();
    expect(await locator.groups([ids.a, ids.b], v)).toEqual([]);
  });

  it("a renamed folder (new key): its mails are absent until the next pass finds them", async () => {
    const { locator, ids } = await world(["INBOX", "Clients 2026"]);
    expect(await locator.groups([ids.b], "0")).toEqual([]);
  });
});
