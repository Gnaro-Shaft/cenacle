/**
 * What the M2 measures read (phase 5): the mails Iris remembers, and for each
 * its subject, sender and display name read again from the server — read-only
 * (EXAMINE, unread count checked: reply-target.ts), in memory, never stored.
 */
import { createMailStore, type StoredInboxItem } from "@cenacle/journal";
import { type Cadre, loadCadre, mailPassword, readReplyContexts } from "@cenacle/mail";

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
}

export async function readBack(sql: Parameters<typeof createMailStore>[0]): Promise<Reading> {
  const cadre = loadCadre();
  const store = createMailStore(sql);
  const position = await store.position("inbox");
  if (position === null) return { cadre, mails: [], gone: 0 };
  const items = (await store.inbox()).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const mailPass = mailPassword(cadre);
  const mails: ReadBack[] = [];
  let gone = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const contexts = await readReplyContexts(
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
  return { cadre, mails, gone };
}
