/**
 * Reading every folder Iris reads, and placing what it finds (ADR-0016).
 *
 * - Each folder is read from where the last pass stopped (its cursor), and
 *   from the start when the server renumbered it. Cursors are committed only
 *   once the mails are saved: a failed pass reads the same mails again.
 * - A mail found where Iris did not know it is the same mail as one she
 *   remembers only if its Message-ID, its sender and its arrival time all
 *   match: then it was moved, and keeps its id, category, verdict and
 *   follow-up. A forged Message-ID alone never takes another mail's place.
 * - The same mail in two folders (a copy) is remembered once.
 */
import type { FolderCursor, Location, LocationStore, MailStore } from "@cenacle/journal";
import type { Folder } from "./folders.ts";
import type { FetchResult, MailRef } from "./postman.ts";

export interface LocatedRef extends MailRef {
  readonly location: Location;
}

export interface FolderRead {
  readonly refs: readonly LocatedRef[];
  /** Every mail still in a read folder, as `folderKey|uidValidity|uid`. */
  readonly present: ReadonlySet<string>;
  /** To commit once the mails are saved. */
  readonly cursors: readonly { readonly folderKey: string; readonly cursor: FolderCursor }[];
  readonly truncated: boolean;
  readonly unseen: number;
}

export const locKey = (l: Location) => `${l.folderKey}|${l.uidValidity}|${l.uid}`;

export async function readFolders(
  folders: readonly Folder[],
  locations: LocationStore,
  fetchFolder: (path: string, afterUid: number) => Promise<FetchResult<MailRef>>,
): Promise<FolderRead> {
  const refs: LocatedRef[] = [];
  const present = new Set<string>();
  const cursors: { folderKey: string; cursor: FolderCursor }[] = [];
  let truncated = false;
  let unseen = 0;
  for (const folder of folders) {
    const cursor = await locations.cursor(folder.key);
    let result = await fetchFolder(folder.path, cursor?.lastUid ?? 0);
    const renumbered = cursor !== null && result.uidValidity !== cursor.uidValidity;
    if (renumbered) result = await fetchFolder(folder.path, 0);
    const from = renumbered || cursor === null ? 0 : cursor.lastUid;
    for (const ref of result.refs) {
      refs.push({
        ...ref,
        location: { folderKey: folder.key, uidValidity: result.uidValidity, uid: ref.uid },
      });
    }
    for (const uid of result.present) {
      present.add(locKey({ folderKey: folder.key, uidValidity: result.uidValidity, uid }));
    }
    cursors.push({
      folderKey: folder.key,
      cursor: {
        uidValidity: result.uidValidity,
        lastUid: Math.max(from, result.lastUid ?? 0, ...result.refs.map((r) => r.uid)),
      },
    });
    truncated ||= result.truncated;
    unseen += result.unseen;
  }
  return { refs, present, cursors, truncated, unseen };
}

export interface Placement {
  /** Mails seen for the first time, to remember. */
  readonly fresh: readonly LocatedRef[];
  /** Mails Iris knew, found in another place (moved, or their folder renumbered). */
  readonly moved: number;
  /** Copies of a mail Iris already knows, still in its place: ignored. */
  readonly copies: number;
}

/** Sorts the refs read this pass into new mails, moved ones (relocated now) and copies. */
export async function placeRefs(
  refs: readonly LocatedRef[],
  present: ReadonlySet<string>,
  locations: LocationStore,
  store: Pick<MailStore, "inbox">,
): Promise<Placement> {
  const known = await locations.all();
  const byPlace = new Set(known.map(locKey));
  const rows = new Map((await store.inbox()).map((r) => [r.uid, r]));
  const fresh: LocatedRef[] = [];
  let moved = 0;
  let copies = 0;
  for (const ref of refs) {
    if (byPlace.has(locKey(ref.location))) continue; // read again after a reset: already placed
    const same =
      ref.messageKey === null
        ? []
        : known.filter((k) => {
            const row = rows.get(k.id);
            return (
              k.messageKey === ref.messageKey &&
              row !== undefined &&
              row.senderKey !== null &&
              row.senderKey === ref.senderKey &&
              Date.parse(row.receivedAt) === Date.parse(ref.receivedAt)
            );
          });
    const left = same.find((k) => !present.has(locKey(k)));
    if (left !== undefined) {
      await locations.move(left.id, ref.location);
      byPlace.delete(locKey(left));
      byPlace.add(locKey(ref.location));
      known[known.indexOf(left)] = { ...left, ...ref.location };
      moved += 1;
    } else if (same.length > 0) {
      copies += 1;
    } else {
      fresh.push(ref);
      byPlace.add(locKey(ref.location));
    }
  }
  return { fresh, moved, copies };
}
