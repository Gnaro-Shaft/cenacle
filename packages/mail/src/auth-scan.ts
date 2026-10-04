/**
 * Reads the authentication headers of the newest inbox mails, for the survey
 * of step 0 (auth-survey.ts). Read-only like the postman: opened with EXAMINE
 * or nothing is read, headers fetched with BODY.PEEK, unread count checked
 * before and after. Headers only — never a subject nor a body.
 *
 * Each raw header block goes straight to `shape` and is dropped: only what
 * `shape` returns is kept.
 */
import { ImapFlow } from "imapflow";
import { SURVEY_HEADERS } from "./auth-survey.ts";
import type { MailCadre } from "./cadre.ts";
import { imapOptions } from "./connection.ts";
import { PostmanError } from "./postman.ts";

export const MAX_SURVEYED = 2000;

export interface ScanOptions {
  /** C4: mails that arrived before are not read; null: no limit (fictional or tiers-free box). */
  readonly notBefore: Date | null;
  /** How many of the newest mails, at most. */
  readonly newest: number;
}

export interface ScanResult<T> {
  /** Oldest first. */
  readonly mails: readonly T[];
  /** Fetched (same arrival day as the limit) but older than it: dropped unshaped. */
  readonly beforeLimit: number;
}

async function unseenCount(client: ImapFlow, mailbox: string): Promise<number> {
  const status = await client.status(mailbox, { unseen: true });
  if (status === false || typeof status.unseen !== "number") {
    throw new PostmanError(`${mailbox}: unread count unavailable`);
  }
  return status.unseen;
}

export async function scanAuthHeaders<T>(
  cadre: MailCadre,
  password: string,
  options: ScanOptions,
  shape: (raw: string) => T,
): Promise<ScanResult<T>> {
  const { notBefore, newest } = options;
  if (!Number.isSafeInteger(newest) || newest < 1 || newest > MAX_SURVEYED) {
    throw new PostmanError(`newest must be an integer between 1 and ${MAX_SURVEYED}`);
  }
  if (password.length === 0) throw new PostmanError("empty mailbox password");
  const client = new ImapFlow(imapOptions(cadre, password));
  await client.connect();
  try {
    const mailbox = cadre.mailbox;
    const unseenBefore = await unseenCount(client, mailbox);
    const mails: { uid: number; value: T }[] = [];
    let beforeLimit = 0;
    const lock = await client.getMailboxLock(mailbox, { readOnly: true });
    try {
      if (client.mailbox === false || !client.mailbox.readOnly) {
        throw new PostmanError(`${mailbox} was not opened read-only — refusing to read`);
      }
      // SINCE is by day: the exact limit is checked on the arrival date below.
      const criteria = notBefore === null ? { all: true } : { since: notBefore };
      const found = await client.search(criteria, { uid: true });
      const uids = (Array.isArray(found) ? found : []).sort((a, b) => a - b).slice(-newest);
      if (uids.length > 0) {
        const query = { uid: true, internalDate: true, headers: SURVEY_HEADERS };
        for await (const msg of client.fetch(uids.join(","), query, { uid: true })) {
          const date = msg.internalDate instanceof Date ? msg.internalDate : null;
          if (date === null || Number.isNaN(date.getTime())) {
            throw new PostmanError(`mail ${msg.uid}: no arrival date`);
          }
          if (notBefore !== null && date < notBefore) {
            beforeLimit++;
            continue;
          }
          mails.push({ uid: msg.uid, value: shape(msg.headers?.toString("utf8") ?? "") });
        }
      }
    } finally {
      lock.release();
    }
    const unseen = await unseenCount(client, mailbox);
    if (unseen !== unseenBefore) {
      throw new PostmanError(
        `unread count changed during a read-only pass (${unseenBefore} → ${unseen})`,
      );
    }
    mails.sort((a, b) => a.uid - b.uid);
    return { mails: mails.map((m) => m.value), beforeLimit };
  } finally {
    await client.logout().catch(() => client.close());
  }
}
