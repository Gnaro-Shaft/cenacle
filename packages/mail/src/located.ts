/**
 * Reading a remembered mail where it is now (ADR-0016). Everything that reads
 * a mail again — the model's sorting, drafts, the page, the executor, the
 * measures — names it by Iris's id; this finds its folder and UID, then reads
 * it read-only with the usual functions, and gives it back under its id.
 * A mail whose location is unknown, or in a folder Iris no longer reads, is
 * simply absent (gone, like a deleted one).
 */
import type { MailForModel } from "@cenacle/core";
import { type LocationStore, VIRTUAL_UID_VALIDITY } from "@cenacle/journal";
import type { MailCadre } from "./cadre.ts";
import { type Folder, listFolders } from "./folders.ts";
import type { Keyer } from "./keys.ts";
import { readMailsForModel } from "./reader.ts";
import { type ReplyContext, type ReplyTarget, readReplyContexts } from "./reply-target.ts";

export interface FolderGroup {
  readonly path: string;
  readonly uidValidity: string;
  /** Iris's id → the server's UID in this folder. */
  readonly ids: ReadonlyMap<number, number>;
}

export interface MailLocator {
  /** Where the mails are, folder by folder. `uidValidity` must be Iris's own numbering. */
  groups(ids: readonly number[], uidValidity: string): Promise<FolderGroup[]>;
}

export function createLocator(deps: {
  readonly cadre: MailCadre;
  readonly password: string;
  readonly keyer: Keyer;
  readonly locations: Pick<LocationStore, "locate">;
  /** The folders Iris reads now; listed on the server by default. */
  readonly folders?: () => Promise<readonly Folder[]>;
}): MailLocator {
  const folders = deps.folders ?? (() => listFolders(deps.cadre, deps.password, deps.keyer));
  return {
    async groups(ids, uidValidity) {
      // Ids from another numbering (before ADR-0016, or a stale proposal) name nothing here.
      if (uidValidity !== VIRTUAL_UID_VALIDITY || ids.length === 0) return [];
      const located = await deps.locations.locate(ids);
      if (located.size === 0) return [];
      const paths = new Map((await folders()).map((f) => [f.key, f.path]));
      const groups = new Map<
        string,
        { path: string; uidValidity: string; ids: Map<number, number> }
      >();
      for (const l of located.values()) {
        const path = paths.get(l.folderKey);
        if (path === undefined) continue; // a folder no longer read: the mail is gone
        const key = `${l.folderKey}|${l.uidValidity}`;
        const group = groups.get(key) ?? { path, uidValidity: l.uidValidity, ids: new Map() };
        group.ids.set(l.id, l.uid);
        groups.set(key, group);
      }
      return [...groups.values()];
    },
  };
}

const inFolder = (cadre: MailCadre, path: string): MailCadre => ({ ...cadre, mailbox: path });
const byUid = (ids: ReadonlyMap<number, number>) => new Map([...ids].map(([id, uid]) => [uid, id]));

export async function readMailsForModelAt(
  locator: MailLocator,
  cadre: MailCadre,
  password: string,
  ids: readonly number[],
  uidValidity: string = VIRTUAL_UID_VALIDITY,
): Promise<MailForModel[]> {
  const out: MailForModel[] = [];
  for (const g of await locator.groups(ids, uidValidity)) {
    const back = byUid(g.ids);
    const read = await readMailsForModel(
      inFolder(cadre, g.path),
      password,
      [...g.ids.values()],
      g.uidValidity,
    );
    for (const mail of read) {
      const id = back.get(mail.uid);
      if (id !== undefined) out.push({ ...mail, uid: id });
    }
  }
  return out;
}

export async function readReplyContextsAt(
  locator: MailLocator,
  cadre: MailCadre,
  password: string,
  ids: readonly number[],
  uidValidity: string,
): Promise<Map<number, ReplyContext>> {
  const out = new Map<number, ReplyContext>();
  for (const g of await locator.groups(ids, uidValidity)) {
    const back = byUid(g.ids);
    const read = await readReplyContexts(
      inFolder(cadre, g.path),
      password,
      [...g.ids.values()],
      g.uidValidity,
    );
    for (const [uid, context] of read) {
      const id = back.get(uid);
      if (id !== undefined) out.set(id, { ...context, uid: id });
    }
  }
  return out;
}

export async function readReplyTargetsAt(
  locator: MailLocator,
  cadre: MailCadre,
  password: string,
  ids: readonly number[],
  uidValidity: string,
): Promise<Map<number, ReplyTarget>> {
  const contexts = await readReplyContextsAt(locator, cadre, password, ids, uidValidity);
  return new Map(
    [...contexts].map(([id, c]) => [
      id,
      { uid: id, to: c.to, replyToElsewhere: c.replyToElsewhere },
    ]),
  );
}
