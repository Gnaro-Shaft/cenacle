/**
 * What the M2 measures read (phase 5): the mails Iris remembers, and for each
 * its subject, sender and display name read again from the server — read-only
 * (EXAMINE, unread count checked: reply-target.ts), in memory, never stored.
 */
import { createLocationStore, createMailStore, type StoredInboxItem } from "@cenacle/journal";
import {
  type Cadre,
  createLocator,
  keyerFromEnv,
  loadCadre,
  mailPassword,
  readMailsForSortingAt,
  readReplyContextsAt,
} from "@cenacle/mail";
import type { ToReplay } from "./mesure-simulation.ts";

/** UIDs per IMAP fetch: a long UID list is a long command line. */
const CHUNK = 200;

export interface ReadBack {
  readonly item: StoredInboxItem;
  readonly subject: string;
  readonly from: string | null;
  readonly fromName: string;
}

export interface Reading {
  readonly cadre: Cadre;
  readonly mails: readonly ReadBack[];
  /** Remembered by Iris, but no longer on the server (deleted, moved). */
  readonly gone: number;
  /** The mailbox numbering the stored UIDs belong to; null before any pass. */
  readonly uidValidity: string | null;
}

function locatorFor(sql: Parameters<typeof createMailStore>[0], cadre: Cadre) {
  const pass = mailPassword(cadre); // read from the environment (.env.mail), never written here
  return createLocator({
    cadre: cadre.mail,
    password: pass,
    keyer: keyerFromEnv(),
    locations: createLocationStore(sql),
  });
}

export async function readBack(sql: Parameters<typeof createMailStore>[0]): Promise<Reading> {
  const cadre = loadCadre();
  const store = createMailStore(sql);
  const position = await store.position("inbox");
  if (position === null) return { cadre, mails: [], gone: 0, uidValidity: null };
  const items = (await store.inbox()).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const mailPass = mailPassword(cadre);
  const locator = locatorFor(sql, cadre);
  const mails: ReadBack[] = [];
  let gone = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    // ADR-0016: each mail is read where it is now, whatever folder I filed it in.
    const contexts = await readReplyContextsAt(
      locator,
      cadre.mail,
      mailPass,
      chunk.map((m) => m.uid),
      position.uidValidity,
    );
    for (const item of chunk) {
      const context = contexts.get(item.uid);
      if (context === undefined) {
        gone += 1;
        continue;
      }
      mails.push({
        item,
        subject: context.subject,
        from: context.to,
        fromName: context.fromName ?? "",
      });
    }
  }
  return { cadre, mails, gone, uidValidity: position.uidValidity };
}

/**
 * For the replay (--simuler): each mail's model view and mass flag, read
 * again where it is now, read-only, in memory — plus the authentication
 * Iris kept for it. Mails no longer on the server are left out.
 */
export async function readForReplay(
  sql: Parameters<typeof createMailStore>[0],
  reading: Reading,
): Promise<ToReplay[]> {
  if (reading.uidValidity === null) return [];
  const mailPass = mailPassword(reading.cadre);
  const locator = locatorFor(sql, reading.cadre);
  const auth = new Map(reading.mails.map((m) => [m.item.uid, m.item.senderAuthenticated]));
  const ids = reading.mails.map((m) => m.item.uid);
  const out: ToReplay[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const read = await readMailsForSortingAt(
      locator,
      reading.cadre.mail,
      mailPass,
      ids.slice(i, i + CHUNK),
      reading.uidValidity,
    );
    for (const { view, mass } of read) {
      out.push({ view, mass, senderAuthenticated: auth.get(view.uid) === true });
    }
  }
  return out;
}
