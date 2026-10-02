/** Test doubles: an in-memory journal and mail store, same contracts as Postgres. */
import type {
  InboxItem,
  Journal,
  MailStore,
  NewEvent,
  SentItem,
  StoredEvent,
  StoredInboxItem,
} from "@cenacle/journal";

export function memoryJournal(): Journal & { events: StoredEvent[] } {
  const events: StoredEvent[] = [];
  return {
    events,
    async append(event: NewEvent) {
      const stored = {
        id: BigInt(events.length + 1),
        occurredAt: new Date(),
        agent: event.agent,
        type: event.type,
        payload: event.payload ?? {},
      };
      events.push(stored);
      return stored;
    },
    async read() {
      return [...events];
    },
  };
}

export function memoryMailStore(): MailStore & {
  inboxRows: Map<number, StoredInboxItem & { uidValidity: string }>;
  sentRows: Map<number, SentItem & { uidValidity: string }>;
} {
  const inboxRows = new Map<number, StoredInboxItem & { uidValidity: string }>();
  const sentRows = new Map<number, SentItem & { uidValidity: string }>();
  const rowsOf = (mailbox: "inbox" | "sent") => (mailbox === "inbox" ? inboxRows : sentRows);
  return {
    inboxRows,
    sentRows,
    async position(mailbox) {
      const rows = [...rowsOf(mailbox).values()];
      const last = rows.at(-1);
      return last === undefined
        ? null
        : { uidValidity: last.uidValidity, lastUid: Math.max(...rows.map((r) => r.uid)) };
    },
    async forget(mailbox) {
      const n = rowsOf(mailbox).size;
      rowsOf(mailbox).clear();
      return n;
    },
    async saveInbox(uidValidity, items: readonly InboxItem[]) {
      let added = 0;
      for (const item of items) {
        if (inboxRows.has(item.uid)) continue;
        inboxRows.set(item.uid, { ...item, uidValidity, category: null, decidedBy: null });
        added++;
      }
      return added;
    },
    async saveSent(uidValidity, items) {
      let added = 0;
      for (const item of items) {
        if (sentRows.has(item.uid)) continue;
        sentRows.set(item.uid, { ...item, uidValidity });
        added++;
      }
      return added;
    },
    async categorize(uid, category, decidedBy) {
      const row = inboxRows.get(uid);
      if (row === undefined || row.category !== null) return false;
      inboxRows.set(uid, { ...row, category, decidedBy });
      return true;
    },
    async uncategorized() {
      return [...inboxRows.values()].filter((r) => r.category === null).map((r) => r.uid);
    },
    async totals() {
      const totals = { clients_prospects: 0, administratif: 0, bruit: 0, a_trier: 0, pending: 0 };
      for (const row of inboxRows.values()) totals[row.category ?? "pending"]++;
      return totals;
    },
    async inbox() {
      return [...inboxRows.values()].map(({ uidValidity: _v, ...item }) => item);
    },
    async sent() {
      return [...sentRows.values()].map(({ uidValidity: _v, ...item }) => item);
    },
    async purgeBefore(cutoff) {
      let n = 0;
      for (const [uid, row] of inboxRows) {
        if (Date.parse(row.receivedAt) < cutoff.getTime()) {
          inboxRows.delete(uid);
          n++;
        }
      }
      for (const [uid, row] of sentRows) {
        if (Date.parse(row.sentAt) < cutoff.getTime()) {
          sentRows.delete(uid);
          n++;
        }
      }
      return n;
    },
  };
}
