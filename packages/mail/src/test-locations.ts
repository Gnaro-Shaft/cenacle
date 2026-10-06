/** Test doubles for ADR-0016: the location store in memory, and one-folder wiring. */
import type { FolderCursor, LocatedMail, Location, LocationStore } from "@cenacle/journal";
import type { CollectDeps } from "./collect.ts";
import type { FetchResult, MailRef } from "./postman.ts";

export function memoryLocationStore(): LocationStore & { rows: Map<number, LocatedMail> } {
  const rows = new Map<number, LocatedMail>();
  const cursors = new Map<string, FolderCursor>();
  let next = 1;
  const placeKey = (l: Location) => `${l.folderKey}|${l.uidValidity}|${l.uid}`;
  return {
    rows,
    async cursor(folderKey) {
      return cursors.get(folderKey) ?? null;
    },
    async setCursor(folderKey, cursor) {
      cursors.set(folderKey, cursor);
    },
    async keepCursors(folderKeys) {
      let dropped = 0;
      for (const key of [...cursors.keys()]) {
        if (!folderKeys.includes(key)) {
          cursors.delete(key);
          dropped++;
        }
      }
      return dropped;
    },
    async all() {
      return [...rows.values()].sort((a, b) => a.id - b.id);
    },
    async locate(ids) {
      return new Map(
        ids.flatMap((id) => (rows.has(id) ? [[id, rows.get(id) as LocatedMail]] : [])),
      );
    },
    async add(location, messageKey) {
      if ([...rows.values()].some((r) => placeKey(r) === placeKey(location))) {
        throw new Error("mail_locations: duplicate place");
      }
      const id = next++;
      rows.set(id, { ...location, id, messageKey });
      return id;
    },
    async move(id, location) {
      const row = rows.get(id);
      if (row === undefined) throw new Error(`mail_locations: no mail ${id} to move`);
      rows.set(id, { ...row, ...location });
    },
    async keepOnly(ids) {
      let dropped = 0;
      for (const id of [...rows.keys()]) {
        if (!ids.includes(id)) {
          rows.delete(id);
          dropped++;
        }
      }
      return dropped;
    },
  };
}

export const INBOX_KEY = "a".repeat(64);

/** The collection wiring of a box with its inbox only, as before ADR-0016. */
export function oneFolder(
  fetchInbox: (afterUid: number) => Promise<FetchResult<MailRef>>,
): Pick<CollectDeps, "folders" | "fetchFolder" | "locations"> {
  return {
    folders: async () => [{ path: "INBOX", key: INBOX_KEY }],
    fetchFolder: (_path, afterUid) => fetchInbox(afterUid),
    locations: memoryLocationStore(),
  };
}
