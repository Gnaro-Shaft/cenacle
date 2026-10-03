/** Test doubles: an in-memory journal and mail store, same contracts as Postgres. */

import {
  draftHash,
  generateAcceptanceKeys,
  PRIVATE_KEY_VAR,
  PUBLIC_KEY_VAR,
  privateKeyFromEnv,
  publicKeyFromEnv,
} from "@cenacle/core";
import type {
  InboxItem,
  Journal,
  MailStore,
  NewEvent,
  Proposal,
  ProposalStatus,
  ProposalStore,
  SentItem,
  SignedAcceptance,
  StoredEvent,
  StoredInboxItem,
} from "@cenacle/journal";
import { ProposalError } from "@cenacle/journal";
import { isAcceptedByPage, signProposal } from "./acceptance.ts";

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
  notified: Set<number>;
  inboxRows: Map<number, StoredInboxItem & { uidValidity: string }>;
  sentRows: Map<number, SentItem & { uidValidity: string }>;
} {
  const inboxRows = new Map<number, StoredInboxItem & { uidValidity: string }>();
  const sentRows = new Map<number, SentItem & { uidValidity: string }>();
  const rowsOf = (mailbox: "inbox" | "sent") => (mailbox === "inbox" ? inboxRows : sentRows);
  const notified = new Set<number>();
  return {
    notified,
    inboxRows,
    sentRows,
    async urgentToNotify(since) {
      return [...inboxRows.values()]
        .filter(
          (r) =>
            r.category === "clients_prospects" &&
            r.urgentTerm &&
            !notified.has(r.uid) &&
            Date.parse(r.receivedAt) >= since.getTime(),
        )
        .map((r) => r.uid);
    },
    async markUrgentNotified(uids) {
      for (const uid of uids) notified.add(uid);
    },
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
    async keepOnly(mailbox, uids) {
      let n = 0;
      for (const uid of [...rowsOf(mailbox).keys()]) {
        if (!uids.includes(uid)) {
          rowsOf(mailbox).delete(uid);
          n++;
        }
      }
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

/** A minimal store with the same transitions as Postgres (the real one has its own tests). */
export function memoryProposalStore(): ProposalStore {
  const rows = new Map<string, Proposal>();
  const move = (id: string, from: ProposalStatus[], to: Partial<Proposal>) => {
    const p = rows.get(id);
    if (p === undefined || !from.includes(p.status)) throw new Error(`cannot move ${id}`);
    const next = { ...p, ...to };
    rows.set(id, next);
    return next;
  };
  return {
    async create(p) {
      if (
        [...rows.values()].some(
          (r) => r.mailUidValidity === p.mailUidValidity && r.mailUid === p.mailUid,
        )
      )
        throw new Error("a proposal already exists for this mail");
      const row: Proposal = {
        ...p,
        createdAt: new Date(),
        reason: "follow_up_due",
        status: "pending",
        decidedAt: null,
        sendAfter: null,
        closedAt: null,
        sentAt: null,
        acceptanceSig: null,
      };
      rows.set(p.id, row);
      return row;
    },
    async skip(p, now) {
      if (
        [...rows.values()].some(
          (r) => r.mailUidValidity === p.mailUidValidity && r.mailUid === p.mailUid,
        )
      )
        throw new Error("a proposal already exists for this mail");
      const row: Proposal = {
        ...p,
        createdAt: now,
        reason: "follow_up_due",
        trame: null,
        draft: null,
        status: "skipped",
        decidedAt: now,
        sendAfter: null,
        closedAt: now,
        sentAt: null,
        acceptanceSig: null,
      };
      rows.set(p.id, row);
      return row;
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async existsFor(v, uid) {
      return [...rows.values()].some((p) => p.mailUidValidity === v && p.mailUid === uid);
    },
    async pending() {
      return [...rows.values()].filter((p) => p.status === "pending");
    },
    async open() {
      return [...rows.values()].filter(
        (p) =>
          p.status === "pending" ||
          p.status === "accepted" ||
          p.status === "sending" ||
          (p.status === "failed" && p.draft !== null),
      );
    },
    async edit(id, draft) {
      return move(id, ["pending"], { draft });
    },
    async accept(id, now, signed) {
      if (draftHash(rows.get(id)?.draft ?? "") !== signed.draftHash) {
        throw new ProposalError(`proposal ${id}: its text is not the one signed`);
      }
      return move(id, ["pending"], {
        status: "accepted",
        decidedAt: now,
        sendAfter: new Date(now.getTime() + 120_000),
        acceptanceSig: signed.signature,
      });
    },
    async refuse(id, now) {
      return move(id, ["pending"], { status: "refused", decidedAt: now, closedAt: now });
    },
    async lapse(id, now) {
      return move(id, ["pending", "accepted"], { status: "lapsed", closedAt: now });
    },
    async cancel(id, now) {
      return move(id, ["accepted"], { status: "cancelled", closedAt: now });
    },
    async dueForSending(now) {
      return [...rows.values()].filter(
        (p) => p.status === "accepted" && (p.sendAfter?.getTime() ?? Infinity) <= now.getTime(),
      );
    },
    async claim(id, now) {
      const p = rows.get(id);
      if (
        p === undefined ||
        p.status !== "accepted" ||
        (p.sendAfter?.getTime() ?? Infinity) > now.getTime()
      )
        throw new ProposalError(
          `proposal ${id} cannot be claimed: it is ${p?.status ?? "missing"}`,
        );
      return move(id, ["accepted"], { status: "sending", sendAfter: null, sentAt: now });
    },
    async markSent(id, now) {
      return move(id, ["sending"], { status: "sent", closedAt: now });
    },
    async markFailed(id, now) {
      return move(id, ["sending"], { status: "failed", closedAt: now });
    },
    async sendsSince(since) {
      return [...rows.values()].filter(
        (p) => p.sentAt !== null && p.sentAt.getTime() >= since.getTime(),
      ).length;
    },
    async wipeOldTexts() {
      return 0;
    },
  };
}

/** A key pair for tests: what the page signs and what the executor checks (ADR-0013). */
export function testAcceptanceKeys() {
  const keys = generateAcceptanceKeys();
  const env = { [PRIVATE_KEY_VAR]: keys.privateKey, [PUBLIC_KEY_VAR]: keys.publicKey };
  const privateKey = privateKeyFromEnv(env);
  const publicKey = publicKeyFromEnv(env);
  return {
    privateKey,
    publicKey,
    signed: (p: Proposal, now: Date): SignedAcceptance => signProposal(privateKey, p, now),
    verify: (p: Proposal): boolean => isAcceptedByPage(publicKey, p),
  };
}

/** One key pair shared by the tests of a run. */
export const TEST_KEYS = testAcceptanceKeys();

/** What the page hands over when I click "Accepter" on this proposal now. */
export async function signedNow(
  store: ProposalStore,
  id: string,
  now: Date,
  keys = TEST_KEYS,
): Promise<SignedAcceptance> {
  const p = await store.get(id);
  if (p === null) throw new ProposalError(`proposal ${id} does not exist`);
  return keys.signed(p, now);
}
