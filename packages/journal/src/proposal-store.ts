/**
 * Proposals (phase 4, B1 — ADR-0004). Every transition is a single guarded
 * UPDATE: if the proposal is not in the expected state (already decided,
 * double click, replay), nothing changes and the call fails loudly.
 */
import type { Sql } from "postgres";

export type ProposalStatus =
  | "pending"
  | "accepted"
  /** Claimed by the executor, being sent (B4). Never retried by itself. */
  | "sending"
  | "failed"
  | "refused"
  | "lapsed"
  | "cancelled"
  | "sent"
  /** Iris decided not to propose (split vote, no fitting template): no text, closed at once. */
  | "skipped";

export interface Proposal {
  readonly id: string;
  readonly createdAt: Date;
  readonly mailUidValidity: string;
  readonly mailUid: number;
  readonly reason: "follow_up_due";
  readonly trame: string | null;
  /** Null once wiped (7 days after closing). */
  readonly draft: string | null;
  readonly status: ProposalStatus;
  readonly decidedAt: Date | null;
  readonly sendAfter: Date | null;
  readonly closedAt: Date | null;
  /** When the executor claimed it (sending, sent or failed). */
  readonly sentAt: Date | null;
  /** The page's signature of my acceptance (ADR-0013); null until accepted. */
  readonly acceptanceSig: string | null;
}

/** My acceptance as the page signed it: the signature, and the hash of the text it covers. */
export interface SignedAcceptance {
  readonly signature: string;
  /** SHA-256 (hex) of the text signed: the acceptance fails if the text is no longer this one. */
  readonly draftHash: string;
}

export interface NewProposal {
  readonly id: string;
  readonly mailUidValidity: string;
  readonly mailUid: number;
  readonly trame: string | null;
  readonly draft: string;
}

export class ProposalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalError";
  }
}

/** The undo delay between my acceptance and the actual sending (ADR-0004). */
export const UNDO_DELAY_MS = 2 * 60 * 1000;
const SLOT_LEFT = /\{[a-z_]+ \?\}/;

export interface ProposalStore {
  /** Fails if this mail already had a proposal — ever (one situation = one proposal). */
  create(proposal: NewProposal): Promise<Proposal>;
  /** Records that Iris will not propose for this mail — once, like a proposal. */
  skip(
    input: { readonly id: string; readonly mailUidValidity: string; readonly mailUid: number },
    now: Date,
  ): Promise<Proposal>;
  get(id: string): Promise<Proposal | null>;
  /** Whether this mail already had a proposal, whatever became of it. */
  existsFor(mailUidValidity: string, mailUid: number): Promise<boolean>;
  pending(): Promise<Proposal[]>;
  /** What the page shows: waiting for me, accepted, being sent, and failed sends (until their text is wiped). */
  open(): Promise<Proposal[]>;
  /** I edit the draft before deciding. */
  edit(id: string, draft: string): Promise<Proposal>;
  /**
   * I accept, on the page: the sending is scheduled after the undo delay.
   * Refused while a slot is left, or if the text is not the one signed.
   */
  /** `undoMs`: the box's undo delay (10 min on a real box, M3); never under UNDO_DELAY_MS. */
  accept(id: string, now: Date, signed: SignedAcceptance, undoMs?: number): Promise<Proposal>;
  refuse(id: string, now: Date): Promise<Proposal>;
  /** The situation no longer holds (I already answered): closed, from pending or accepted. */
  lapse(id: string, now: Date): Promise<Proposal>;
  /** I undo within the delay. */
  cancel(id: string, now: Date): Promise<Proposal>;
  /** Proposals whose undo delay is over: ready for the executor. */
  dueForSending(now: Date): Promise<Proposal[]>;
  /**
   * The executor takes an accepted proposal whose undo delay is over, BEFORE
   * talking to the mail server. Atomic: of two executors, one wins, the other
   * gets an error. Once claimed, it can only become sent or failed.
   */
  claim(id: string, now: Date): Promise<Proposal>;
  markSent(id: string, now: Date): Promise<Proposal>;
  markFailed(id: string, now: Date): Promise<Proposal>;
  /**
   * The executor refuses an acceptance without a valid signature, before any
   * claim: failed, without a sending time (not counted in the daily ceiling).
   */
  refuseUnsigned(id: string, now: Date): Promise<Proposal>;
  /** Sending attempts since a moment (the daily limit). */
  sendsSince(since: Date): Promise<number>;
  /** Wipes the text of proposals closed more than `days` ago (cadre.toml). Returns how many. */
  wipeOldTexts(now: Date, days: number): Promise<number>;
}

interface Row {
  id: string;
  created_at: Date;
  mail_uid_validity: string;
  mail_uid: string;
  reason: "follow_up_due";
  trame: string | null;
  draft: string | null;
  status: ProposalStatus;
  decided_at: Date | null;
  send_after: Date | null;
  closed_at: Date | null;
  sent_at: Date | null;
  acceptance_sig: string | null;
}

const toProposal = (r: Row): Proposal => ({
  id: r.id,
  createdAt: r.created_at,
  mailUidValidity: r.mail_uid_validity,
  mailUid: Number(r.mail_uid),
  reason: r.reason,
  trame: r.trame,
  draft: r.draft,
  status: r.status,
  decidedAt: r.decided_at,
  sendAfter: r.send_after,
  closedAt: r.closed_at,
  sentAt: r.sent_at,
  acceptanceSig: r.acceptance_sig,
});

export function createProposalStore(sql: Sql): ProposalStore {
  async function one(rows: Row[], id: string, what: string): Promise<Proposal> {
    const [row] = rows;
    if (row !== undefined) return toProposal(row);
    const current = await get(id);
    throw new ProposalError(
      current === null
        ? `proposal ${id} does not exist`
        : `proposal ${id} cannot be ${what}: it is ${current.status}`,
    );
  }

  async function get(id: string): Promise<Proposal | null> {
    const [row] = await sql<Row[]>`select * from proposals where id = ${id}`;
    return row === undefined ? null : toProposal(row);
  }

  return {
    async create(p) {
      try {
        const rows = await sql<Row[]>`
          insert into proposals (id, mail_uid_validity, mail_uid, reason, trame, draft)
          values (${p.id}, ${p.mailUidValidity}, ${p.mailUid}, 'follow_up_due', ${p.trame}, ${p.draft})
          returning *`;
        return one(rows, p.id, "created");
      } catch (error) {
        if (String(error).includes("duplicate key")) {
          throw new ProposalError(`a proposal already exists for this mail (or this id)`);
        }
        throw error;
      }
    },

    async skip(p, now) {
      try {
        const rows = await sql<Row[]>`
          insert into proposals (id, mail_uid_validity, mail_uid, reason, status, decided_at, closed_at)
          values (${p.id}, ${p.mailUidValidity}, ${p.mailUid}, 'follow_up_due', 'skipped', ${now}, ${now})
          returning *`;
        return one(rows, p.id, "skipped");
      } catch (error) {
        if (String(error).includes("duplicate key")) {
          throw new ProposalError(`a proposal already exists for this mail (or this id)`);
        }
        throw error;
      }
    },

    get,

    async existsFor(mailUidValidity, mailUid) {
      const [row] = await sql`
        select 1 from proposals where mail_uid_validity = ${mailUidValidity} and mail_uid = ${mailUid}`;
      return row !== undefined;
    },

    async pending() {
      const rows = await sql<
        Row[]
      >`select * from proposals where status = 'pending' order by created_at`;
      return rows.map(toProposal);
    },

    async open() {
      const rows = await sql<Row[]>`
        select * from proposals
        where status in ('pending', 'accepted', 'sending') or (status = 'failed' and draft is not null)
        order by created_at`;
      return rows.map(toProposal);
    },

    async edit(id, draft) {
      return one(
        await sql<
          Row[]
        >`update proposals set draft = ${draft} where id = ${id} and status = 'pending' returning *`,
        id,
        "edited",
      );
    },

    async accept(id, now, signed, undoMs = UNDO_DELAY_MS) {
      if (!Number.isFinite(undoMs) || undoMs < UNDO_DELAY_MS) {
        throw new ProposalError(`proposal ${id}: the undo delay cannot be under 2 minutes`);
      }
      const current = await get(id);
      if (
        current?.draft !== null &&
        current?.draft !== undefined &&
        SLOT_LEFT.test(current.draft)
      ) {
        throw new ProposalError(`proposal ${id} still has a slot to complete`);
      }
      const sendAfter = new Date(now.getTime() + undoMs);
      return one(
        await sql<Row[]>`
          update proposals set status = 'accepted', decided_at = ${now}, send_after = ${sendAfter},
                 acceptance_sig = ${signed.signature}
          where id = ${id} and status = 'pending'
            and encode(sha256(convert_to(draft, 'UTF8')), 'hex') = ${signed.draftHash}
          returning *`,
        id,
        "accepted (or its text is not the one signed)",
      );
    },

    async refuse(id, now) {
      return one(
        await sql<Row[]>`
          update proposals set status = 'refused', decided_at = ${now}, closed_at = ${now}
          where id = ${id} and status = 'pending' returning *`,
        id,
        "refused",
      );
    },

    async lapse(id, now) {
      return one(
        await sql<Row[]>`
          update proposals set status = 'lapsed', decided_at = coalesce(decided_at, ${now}),
                 send_after = null, closed_at = ${now}
          where id = ${id} and status in ('pending', 'accepted') returning *`,
        id,
        "lapsed",
      );
    },

    async cancel(id, now) {
      return one(
        await sql<Row[]>`
          update proposals set status = 'cancelled', send_after = null, closed_at = ${now}
          where id = ${id} and status = 'accepted' and send_after > ${now} returning *`,
        id,
        "cancelled (the undo delay is over, or it was not accepted)",
      );
    },

    async dueForSending(now) {
      const rows = await sql<Row[]>`
        select * from proposals where status = 'accepted' and send_after <= ${now} order by send_after`;
      return rows.map(toProposal);
    },

    async claim(id, now) {
      return one(
        await sql<Row[]>`
          update proposals set status = 'sending', send_after = null, sent_at = ${now}
          where id = ${id} and status = 'accepted' and send_after <= ${now} returning *`,
        id,
        "claimed for sending (not accepted, or the undo delay is not over)",
      );
    },

    async markSent(id, now) {
      return one(
        await sql<Row[]>`
          update proposals set status = 'sent', closed_at = ${now}
          where id = ${id} and status = 'sending' returning *`,
        id,
        "marked sent",
      );
    },

    async markFailed(id, now) {
      return one(
        await sql<Row[]>`
          update proposals set status = 'failed', closed_at = ${now}
          where id = ${id} and status = 'sending' returning *`,
        id,
        "marked failed",
      );
    },

    async refuseUnsigned(id, now) {
      return one(
        await sql<Row[]>`
          update proposals set status = 'failed', send_after = null, closed_at = ${now}
          where id = ${id} and status = 'accepted' returning *`,
        id,
        "refused as unsigned",
      );
    },

    async sendsSince(since) {
      const [row] = await sql<{ n: string }[]>`
        select count(*) as n from proposals where sent_at >= ${since}`;
      return Number(row?.n ?? 0);
    },

    async wipeOldTexts(now, days) {
      const cutoff = new Date(now.getTime() - days * 24 * 3600 * 1000);
      const result = await sql`
        update proposals set draft = null where draft is not null and closed_at < ${cutoff}`;
      return result.count;
    },
  };
}
