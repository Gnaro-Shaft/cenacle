/**
 * The rights of the people Iris reads about (phase 5, C3 — GDPR art. 15-21).
 *
 * A person is known only by the HMAC key of their address (ADR-0012): what
 * Iris holds on them is found by that key, exported, or erased. An erasure
 * also puts the key on the opposition list, which the collection honours from
 * then on: otherwise their mails, still in my mailbox, would be read again.
 * A key leaves the list `opposition_jours` after the person's last trace
 * (purges.ts): their request, or the last mail from or to them met and ignored.
 */
import type { Sql } from "postgres";

const KEY = /^[0-9a-f]{64}$/;

export interface Holdings {
  /** Their mails in my inbox: what Iris remembers of each. */
  readonly received: readonly {
    readonly receivedAt: string;
    readonly category: string | null;
    readonly decidedBy: string | null;
  }[];
  /** My sent mails where they are a recipient. */
  readonly sentTo: readonly { readonly sentAt: string }[];
  /** Proposals answering their mails; `draft` is null once wiped. */
  readonly proposals: readonly {
    readonly status: string;
    readonly createdAt: string;
    readonly decidedAt: string | null;
    readonly closedAt: string | null;
    readonly draft: string | null;
  }[];
  /** Whether they are on the opposition list. */
  readonly opposed: boolean;
}

export interface Erasure {
  readonly received: number;
  readonly sentTo: number;
  readonly proposals: number;
}

export interface People {
  holdings(key: string): Promise<Holdings>;
  /** Erases what Iris holds on them, and puts them on the opposition list. */
  erase(key: string): Promise<Erasure>;
  /** The keys the collection must ignore. */
  opposedKeys(): Promise<ReadonlySet<string>>;
  /**
   * The collection met mails from or to opposed people, and ignored them:
   * each key's last trace moves to the latest mail's date (never ahead of now).
   */
  touch(traces: ReadonlyMap<string, Date>): Promise<void>;
  /** The person withdraws their objection. Returns whether they were on the list. */
  withdraw(key: string): Promise<boolean>;
  /** The whole opposition list, for the encrypted backup (keys and dates only). */
  opposition(): Promise<OppositionEntry[]>;
  /** Writes back a backed-up list; keys already there are left as they are. Returns how many were added. */
  restoreOpposition(entries: readonly OppositionEntry[]): Promise<number>;
}

export interface OppositionEntry {
  readonly key: string;
  /** ISO time of the request. */
  readonly since: string;
  /** ISO date of the last mail met from or to them, if any (older backups have none). */
  readonly lastSeen?: string | null;
}

interface MailRow {
  uid_validity: string;
  uid: string;
  at: Date;
  category: string | null;
  decided_by: string | null;
}

interface ProposalRow {
  status: string;
  created_at: Date;
  decided_at: Date | null;
  closed_at: Date | null;
  draft: string | null;
}

function checked(key: string): string {
  if (!KEY.test(key)) throw new Error("not a key: 64 lowercase hex characters expected");
  return key;
}

const iso = (d: Date | null) => (d === null ? null : d.toISOString());

export function createPeople(sql: Sql): People {
  return {
    async holdings(raw) {
      const key = checked(raw);
      const mails = await sql<MailRow[]>`
        select uid_validity, uid::text, at, category, decided_by from mail_items
        where mailbox = 'inbox' and sender_key = ${key} order by at`;
      const sent = await sql<{ at: Date }[]>`
        select at from mail_items where mailbox = 'sent' and ${key} = any(recipient_keys)
        order by at`;
      const proposals = [];
      for (const m of mails) {
        const rows = await sql<ProposalRow[]>`
          select status, created_at, decided_at, closed_at, draft from proposals
          where mail_uid_validity = ${m.uid_validity} and mail_uid = ${m.uid}`;
        for (const p of rows) {
          proposals.push({
            status: p.status,
            createdAt: p.created_at.toISOString(),
            decidedAt: iso(p.decided_at),
            closedAt: iso(p.closed_at),
            draft: p.draft,
          });
        }
      }
      const [opposed] = await sql`select 1 from opposed_keys where key = ${key}`;
      return {
        received: mails.map((m) => ({
          receivedAt: m.at.toISOString(),
          category: m.category,
          decidedBy: m.decided_by,
        })),
        sentTo: sent.map((s) => ({ sentAt: s.at.toISOString() })),
        proposals,
        opposed: opposed !== undefined,
      };
    },

    async erase(raw) {
      const key = checked(raw);
      return sql.begin(async (tx) => {
        // On the list first: a collection running meanwhile already ignores them.
        await tx`insert into opposed_keys (key) values (${key}) on conflict (key) do nothing`;
        const mails = await tx<{ uid_validity: string; uid: string }[]>`
          select uid_validity, uid::text from mail_items
          where mailbox = 'inbox' and sender_key = ${key}`;
        const byValidity = new Map<string, string[]>();
        for (const m of mails) {
          byValidity.set(m.uid_validity, [...(byValidity.get(m.uid_validity) ?? []), m.uid]);
        }
        let proposals = 0;
        for (const [validity, uids] of byValidity) {
          const [row] = await tx<{ n: number }[]>`
            select erase_proposals_for(${validity}, ${uids}::bigint[]) as n`;
          if (row === undefined) throw new Error("erase_proposals_for returned no count");
          proposals += row.n;
        }
        const received = await tx`
          delete from mail_items where mailbox = 'inbox' and sender_key = ${key}`;
        // A mail sent to several people: only their key leaves, the others' stays.
        const sentTo = await tx`
          update mail_items set recipient_keys = array_remove(recipient_keys, ${key})
          where mailbox = 'sent' and ${key} = any(recipient_keys)`;
        return { received: received.count, sentTo: sentTo.count, proposals };
      });
    },

    async opposedKeys() {
      const rows = await sql<{ key: string }[]>`select key from opposed_keys`;
      return new Set(rows.map((r) => r.key));
    },

    async touch(traces) {
      for (const [raw, at] of traces) {
        const key = checked(raw);
        if (Number.isNaN(at.getTime())) continue;
        // A mail dated in the future (a wrong clock, a forged header) counts as now.
        await sql`
          update opposed_keys
          set last_seen = greatest(last_seen, least(${at}::timestamptz, clock_timestamp()))
          where key = ${key}`;
      }
    },

    async opposition() {
      const rows = await sql<{ key: string; since: Date; last_seen: Date | null }[]>`
        select key, since, last_seen from opposed_keys order by since`;
      return rows.map((r) => ({
        key: r.key,
        since: r.since.toISOString(),
        lastSeen: iso(r.last_seen),
      }));
    },

    async restoreOpposition(entries) {
      let added = 0;
      for (const e of entries) {
        const key = checked(e.key);
        const since = new Date(e.since);
        if (Number.isNaN(since.getTime()))
          throw new Error("a backed-up opposition has no valid date");
        const lastSeen = e.lastSeen == null ? null : new Date(e.lastSeen);
        if (lastSeen !== null && Number.isNaN(lastSeen.getTime()))
          throw new Error("a backed-up opposition has an invalid last trace");
        const result = await sql`
          insert into opposed_keys (key, since, last_seen) values (${key}, ${since}, ${lastSeen})
          on conflict (key) do nothing`;
        added += result.count;
      }
      return added;
    },

    async withdraw(raw) {
      const key = checked(raw);
      const result = await sql`delete from opposed_keys where key = ${key}`;
      return result.count > 0;
    },
  };
}
