/**
 * The prospection agent's cards and the alerts it has read (ADR-0032,
 * sql/027_prospection.sql). The agent only adds: a card it placed is never
 * moved by it again (my moves come with the board, lot 3). Purged by the
 * agent at each pass, 60 days after a card's creation or my last move.
 */
import type { Sql } from "postgres";

export const READ_OUTCOMES = [
  "read",
  "floor",
  "too_big",
  "not_platform",
  "unauthenticated",
  "unparsable",
  "no_offer",
] as const;
export type ReadOutcome = (typeof READ_OUTCOMES)[number];

export interface NewCard {
  readonly source: "mail" | "me";
  readonly platform: string | null;
  readonly title: string;
  readonly company: string | null;
  readonly intermediary: "esn" | "direct" | "inconnu";
  readonly stack: readonly string[];
  readonly rate: readonly [number, number] | null;
  readonly remote: "total" | "partiel" | "aucun" | "inconnu";
  readonly place: string | null;
  readonly link: string | null;
  readonly note: string | null;
  readonly column: string;
  readonly reason: string | null;
  readonly decidedBy: "rule" | "model" | "me";
  readonly toCheck: boolean;
  readonly duplicateKey: string | null;
}

export interface Card extends NewCard {
  readonly id: number;
  readonly createdAt: Date;
  readonly movedAt: Date | null;
}

export interface ProspectionStore {
  /** Of these mail ids, those never read by the agent. */
  unread(ids: readonly number[]): Promise<number[]>;
  /**
   * One alert, in one transaction: its cards added (a duplicate key is skipped
   * and counted), then the mail marked read. A failure leaves both undone.
   */
  recordMail(
    mailId: number,
    outcome: ReadOutcome,
    cards: readonly NewCard[],
  ): Promise<{ added: number; duplicates: number }>;
  cards(): Promise<Card[]>;
  /** Cards whose company holds these words (case ignored): for a request of access. */
  byCompany(words: string): Promise<Card[]>;
  /** Erases one card; true when it existed. */
  erase(id: number): Promise<boolean>;
  /** Cards neither created nor moved since the cutoff are deleted; returns how many. */
  purge(cutoff: Date): Promise<number>;
}

interface Row {
  id: string;
  source: "mail" | "me";
  platform: string | null;
  title: string;
  company: string | null;
  intermediary: NewCard["intermediary"];
  stack: string[];
  rate_min: number | null;
  rate_max: number | null;
  remote: NewCard["remote"];
  place: string | null;
  link: string | null;
  note: string | null;
  board_column: string;
  reason: string | null;
  decided_by: NewCard["decidedBy"];
  to_check: boolean;
  duplicate_key: string | null;
  created_at: Date;
  moved_at: Date | null;
}

const toCard = (r: Row): Card => ({
  id: Number(r.id),
  source: r.source,
  platform: r.platform,
  title: r.title,
  company: r.company,
  intermediary: r.intermediary,
  stack: r.stack,
  rate: r.rate_min === null || r.rate_max === null ? null : [r.rate_min, r.rate_max],
  remote: r.remote,
  place: r.place,
  link: r.link,
  note: r.note,
  column: r.board_column,
  reason: r.reason,
  decidedBy: r.decided_by,
  toCheck: r.to_check,
  duplicateKey: r.duplicate_key,
  createdAt: r.created_at,
  movedAt: r.moved_at,
});

export function createProspectionStore(sql: Sql): ProspectionStore {
  return {
    async unread(ids) {
      if (ids.length === 0) return [];
      const read = await sql<{ mail_id: string }[]>`
        select mail_id::text from prospection_mails_lus where mail_id = any(${ids as number[]})`;
      const done = new Set(read.map((r) => Number(r.mail_id)));
      return ids.filter((id) => !done.has(id));
    },

    async recordMail(mailId, outcome, cards) {
      return sql.begin(async (tx) => {
        let added = 0;
        for (const c of cards) {
          const rows = await tx`
            insert into prospection_cartes (
              source, platform, title, company, intermediary, stack, rate_min, rate_max,
              remote, place, link, note, board_column, reason, decided_by, to_check, duplicate_key)
            values (
              ${c.source}, ${c.platform}, ${c.title}, ${c.company}, ${c.intermediary},
              ${c.stack as string[]}, ${c.rate?.[0] ?? null}, ${c.rate?.[1] ?? null},
              ${c.remote}, ${c.place}, ${c.link}, ${c.note}, ${c.column}, ${c.reason},
              ${c.decidedBy}, ${c.toCheck}, ${c.duplicateKey})
            on conflict (duplicate_key) do nothing
            returning id`;
          added += rows.length;
        }
        await tx`
          insert into prospection_mails_lus (mail_id, outcome) values (${mailId}, ${outcome})`;
        return { added, duplicates: cards.length - added };
      });
    },

    async cards() {
      return (await sql<Row[]>`select * from prospection_cartes order by id`).map(toCard);
    },

    async byCompany(words) {
      const pattern = `%${words.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const rows = await sql<Row[]>`
        select * from prospection_cartes
        where company ilike ${pattern} order by id`;
      return rows.map(toCard);
    },

    async erase(id) {
      const result = await sql`delete from prospection_cartes where id = ${id}`;
      return result.count > 0;
    },

    async purge(cutoff) {
      const result = await sql`
        delete from prospection_cartes
        where greatest(created_at, coalesce(moved_at, created_at)) < ${cutoff}`;
      return result.count;
    },
  };
}
