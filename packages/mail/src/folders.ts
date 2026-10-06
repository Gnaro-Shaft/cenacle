/**
 * Which folders Iris reads (ADR-0016, decided on 2026-10-06): every folder of
 * the box, the inbox included, except the ones the server marks as Sent,
 * Trash, Junk or Drafts (read by their special-use flag, never guessed from a
 * name), virtual ones (All, Flagged), folders that hold no mail (\Noselect),
 * and the Sent folder of the cadre. Folders are known by their HMAC key; a
 * path never leaves this process (it may name a client).
 */
import { ImapFlow } from "imapflow";
import type { MailCadre } from "./cadre.ts";
import { imapOptions } from "./connection.ts";
import type { Keyer } from "./keys.ts";

/** Special-use flags (RFC 6154) of the folders Iris never reads. */
export const SKIPPED_FOLDERS: ReadonlySet<string> = new Set([
  "\\Sent",
  "\\Trash",
  "\\Junk",
  "\\Drafts",
  "\\All",
  "\\Flagged",
]);
/** Folders read at most per pass: a box with thousands of folders is a mistake to stop on. */
export const MAX_FOLDERS = 200;

export interface Folder {
  readonly path: string;
  readonly key: string;
}

export interface ListedFolder {
  readonly path: string;
  readonly specialUse?: string | undefined;
  readonly flags?: ReadonlySet<string> | undefined;
}

export class FolderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FolderError";
  }
}

export function readableFolders(
  listed: readonly ListedFolder[],
  sentMailbox: string,
  keyer: Keyer,
): Folder[] {
  const folders = listed
    .filter(
      (f) =>
        !f.flags?.has("\\Noselect") &&
        !f.flags?.has("\\NonExistent") &&
        (f.specialUse === undefined || !SKIPPED_FOLDERS.has(f.specialUse)) &&
        f.path !== sentMailbox,
    )
    .map((f) => ({ path: f.path, key: keyer.folder(f.path) }));
  if (folders.length > MAX_FOLDERS) {
    throw new FolderError(`more than ${MAX_FOLDERS} folders to read: refusing to guess which`);
  }
  return folders;
}

/** The folders of the box Iris reads, now. */
export async function listFolders(
  cadre: MailCadre,
  password: string,
  keyer: Keyer,
): Promise<Folder[]> {
  const client = new ImapFlow(imapOptions(cadre, password));
  await client.connect();
  try {
    return readableFolders(await client.list(), cadre.sentMailbox, keyer);
  } finally {
    await client.logout().catch(() => client.close());
  }
}
