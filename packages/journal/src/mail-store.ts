/**
 * What Iris remembers of each mail between two passes (phase 3, S1).
 *
 * Only UIDs, dates, categories and pseudonymous keys (see sql/002_mail_items.sql).
 * The store never receives an address, a subject or a body: its inputs are
 * already keyed by the postman.
 */
import type { Sql } from "postgres";

export const CATEGORY_VALUES = ["clients_prospects", "administratif", "bruit", "a_trier"] as const;
export type StoredCategory = (typeof CATEGORY_VALUES)[number];
/**
 * "set_aside": kept from the model (article 9 floor, empty or unreadable) — never why (C2).
 * "unauthenticated": a client rule refused for an unauthenticated sender (ADR-0014).
 */
export type DecidedBy = "rule" | "unreadable" | "model" | "set_aside" | "unauthenticated";
export type Mailbox = "inbox" | "sent";

export interface InboxItem {
  readonly uid: number;
  readonly receivedAt: string;
  /** Its domain never expects a reply by mail: never followed up. */
  readonly noFollowUp: boolean;
  /** An urgency term was in its subject (the subject is not stored). */
  readonly urgentTerm: boolean;
  /** Our receiving server authenticated its From domain (ADR-0014). */
  readonly senderAuthenticated: boolean;
  readonly senderKey: string | null;
  readonly messageKey: string | null;
  readonly threadKeys: readonly string[];
}

export interface SentItem {
  readonly uid: number;
  readonly sentAt: string;
  readonly recipientKeys: readonly string[];
  readonly messageKey: string | null;
  readonly threadKeys: readonly string[];
}

export interface StoredInboxItem extends InboxItem {
  readonly category: StoredCategory | null;
  readonly decidedBy: DecidedBy | null;
}

export interface Position {
  readonly uidValidity: string;
  readonly lastUid: number;
}

export type Totals = Readonly<Record<StoredCategory, number>> & { readonly pending: number };

export interface MailStore {
  /** Where the last pass stopped in this mailbox; null if nothing is remembered. */
  position(mailbox: Mailbox): Promise<Position | null>;
  /** Forgets a whole mailbox (its UIDs were renumbered). Returns the rows deleted. */
  forget(mailbox: Mailbox): Promise<number>;
  /** Forgets the mails of a mailbox that are no longer on the server (deleted or moved). */
  keepOnly(mailbox: Mailbox, uids: readonly number[]): Promise<number>;
  /** Remembers new mails; already known ones are left as they are. Returns the rows added. */
  saveInbox(uidValidity: string, items: readonly InboxItem[]): Promise<number>;
  saveSent(uidValidity: string, items: readonly SentItem[]): Promise<number>;
  /** Sets the category of a mail that has none yet. Returns false if it already had one. */
  categorize(uid: number, category: StoredCategory, decidedBy: DecidedBy): Promise<boolean>;
  /** Inbox mails still without a category (left for the model, or waiting for the Mac). */
  uncategorized(): Promise<number[]>;
  totals(): Promise<Totals>;
  inbox(): Promise<StoredInboxItem[]>;
  sent(): Promise<SentItem[]>;
  /** Urgent client mails from authenticated senders, received since `since`, not told yet. */
  urgentToNotify(since: Date): Promise<number[]>;
  /** Records that I was told about these urgent mails (alert or recap). */
  markUrgentNotified(uids: readonly number[]): Promise<void>;
  /** Retention: deletes every mail that arrived before `cutoff`. Returns the rows deleted. */
  purgeBefore(cutoff: Date): Promise<number>;
}

interface Row {
  uid: string;
  at: Date;
  no_follow_up: boolean;
  urgent_term: boolean;
  sender_authenticated: boolean;
  category: StoredCategory | null;
  decided_by: DecidedBy | null;
  sender_key: string | null;
  recipient_keys: string[];
  message_key: string | null;
  thread_keys: string[];
}

export function createMailStore(sql: Sql): MailStore {
  const currentValidity = async (mailbox: Mailbox) => (await position(mailbox))?.uidValidity ?? "";

  async function position(mailbox: Mailbox): Promise<Position | null> {
    const rows = await sql<{ uid_validity: string; last: string }[]>`
      select uid_validity, max(uid)::text as last from mail_items
      where mailbox = ${mailbox} group by uid_validity`;
    if (rows.length === 0) return null;
    if (rows.length > 1) throw new Error(`${mailbox}: several UIDVALIDITY values remembered`);
    const [row] = rows;
    return row === undefined ? null : { uidValidity: row.uid_validity, lastUid: Number(row.last) };
  }

  return {
    position,

    async forget(mailbox) {
      return (await sql`delete from mail_items where mailbox = ${mailbox}`).count;
    },

    async keepOnly(mailbox, uids) {
      const result = await sql`
        delete from mail_items
        where mailbox = ${mailbox} and not (uid = any(${sql.array(uids.map(String))}::bigint[]))`;
      return result.count;
    },

    async saveInbox(uidValidity, items) {
      let added = 0;
      for (const item of items) {
        const result = await sql`
          insert into mail_items (mailbox, uid_validity, uid, at, no_follow_up, urgent_term,
                                  sender_authenticated, sender_key, message_key, thread_keys)
          values ('inbox', ${uidValidity}, ${item.uid}, ${item.receivedAt}, ${item.noFollowUp},
                  ${item.urgentTerm}, ${item.senderAuthenticated}, ${item.senderKey},
                  ${item.messageKey}, ${sql.array([...item.threadKeys])})
          on conflict do nothing`;
        added += result.count;
      }
      return added;
    },

    async saveSent(uidValidity, items) {
      let added = 0;
      for (const item of items) {
        const result = await sql`
          insert into mail_items (mailbox, uid_validity, uid, at, recipient_keys, message_key, thread_keys)
          values ('sent', ${uidValidity}, ${item.uid}, ${item.sentAt}, ${sql.array([...item.recipientKeys])},
                  ${item.messageKey}, ${sql.array([...item.threadKeys])})
          on conflict do nothing`;
        added += result.count;
      }
      return added;
    },

    async categorize(uid, category, decidedBy) {
      const validity = await currentValidity("inbox");
      const result = await sql`
        update mail_items set category = ${category}, decided_by = ${decidedBy}
        where mailbox = 'inbox' and uid_validity = ${validity} and uid = ${uid} and category is null`;
      return result.count === 1;
    },

    async uncategorized() {
      const rows = await sql<{ uid: string }[]>`
        select uid::text from mail_items
        where mailbox = 'inbox' and category is null order by uid`;
      return rows.map((r) => Number(r.uid));
    },

    async totals() {
      const rows = await sql<{ category: StoredCategory | null; n: string }[]>`
        select category, count(*)::text as n from mail_items
        where mailbox = 'inbox' group by category`;
      const totals = { clients_prospects: 0, administratif: 0, bruit: 0, a_trier: 0, pending: 0 };
      for (const row of rows) totals[row.category ?? "pending"] = Number(row.n);
      return totals;
    },

    async inbox() {
      const rows = await sql<Row[]>`
        select uid::text, at, no_follow_up, urgent_term, sender_authenticated, category, decided_by,
               sender_key, recipient_keys, message_key, thread_keys
        from mail_items where mailbox = 'inbox' order by uid`;
      return rows.map((r) => ({
        uid: Number(r.uid),
        receivedAt: r.at.toISOString(),
        noFollowUp: r.no_follow_up,
        urgentTerm: r.urgent_term,
        senderAuthenticated: r.sender_authenticated,
        senderKey: r.sender_key,
        messageKey: r.message_key,
        threadKeys: r.thread_keys,
        category: r.category,
        decidedBy: r.decided_by,
      }));
    },

    async sent() {
      const rows = await sql<Row[]>`
        select uid::text, at, recipient_keys, message_key, thread_keys
        from mail_items where mailbox = 'sent' order by uid`;
      return rows.map((r) => ({
        uid: Number(r.uid),
        sentAt: r.at.toISOString(),
        recipientKeys: r.recipient_keys,
        messageKey: r.message_key,
        threadKeys: r.thread_keys,
      }));
    },

    async urgentToNotify(since) {
      const rows = await sql<{ uid: string }[]>`
        select uid::text from mail_items
        -- A set-aside mail may be an urgent client's (C2): never lose its alert silently.
        where mailbox = 'inbox' and (category = 'clients_prospects' or decided_by = 'set_aside')
          and urgent_term
          -- ADR-0014: a forged From must never ring the alarm.
          and sender_authenticated
          and not urgent_notified and at >= ${since}
        order by uid`;
      return rows.map((r) => Number(r.uid));
    },

    async markUrgentNotified(uids) {
      if (uids.length === 0) return;
      await sql`
        update mail_items set urgent_notified = true
        where mailbox = 'inbox' and uid = any(${sql.array(uids.map(String))}::bigint[])`;
    },

    async purgeBefore(cutoff) {
      return (await sql`delete from mail_items where at < ${cutoff}`).count;
    },
  };
}
