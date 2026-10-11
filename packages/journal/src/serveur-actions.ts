/**
 * Actions on the servers (J6f, ADR-0027), in the database: my button makes a
 * request, my confirmation within 60 seconds makes it runnable, the operator
 * claims it (one at a time, whatever the machine — the database refuses a
 * second), runs it, and records the outcome; Legion's next verdict tells
 * whether the problem went away. Every step is a guarded update: a stale
 * token, a late confirmation or a double tap changes nothing.
 */
import { randomBytes } from "node:crypto";
import type { Sql } from "postgres";

export type ServerAction = "services";
export type ServerActionState =
  | "demandee"
  | "confirmee"
  | "expiree"
  | "en_cours"
  | "faite"
  | "rien_a_faire"
  | "refusee_serveur"
  | "refusee"
  | "echouee";
export type FinalState = Exclude<ServerActionState, "demandee" | "confirmee" | "en_cours">;
export type Verified = "disparu" | "toujours_la";
export type ConfirmOutcome = "done" | "stale" | "expired" | "already";

export interface StoredServerAction {
  readonly id: number;
  readonly findingId: number;
  readonly host: string;
  readonly action: ServerAction;
  readonly state: ServerActionState;
  readonly requestedAt: Date;
  readonly finishedAt: Date | null;
  readonly exitCode: number | null;
  readonly refusal: string | null;
  readonly verified: Verified | null;
}

/** How long a confirmation stays possible. */
export const CONFIRM_SECONDS = 60;
/** A run longer than this was cut off (the operator stopped mid-run): it failed. */
export const STALE_RUN_MINUTES = 5;
export const ACTIONS_DAYS = 365;

const TOKEN = /^[0-9a-f]{16}$/;
const FINAL: readonly FinalState[] = [
  "expiree",
  "faite",
  "rien_a_faire",
  "refusee_serveur",
  "refusee",
  "echouee",
];

interface Row {
  id: string;
  finding_id: string;
  host: string;
  action: ServerAction;
  state: ServerActionState;
  requested_at: Date;
  finished_at: Date | null;
  exit_code: number | null;
  refusal: string | null;
  verified: Verified | null;
}
const COLUMNS =
  "id, finding_id, host, action, state, requested_at, finished_at, exit_code, refusal, verified";
const toAction = (r: Row): StoredServerAction => ({
  id: Number(r.id),
  findingId: Number(r.finding_id),
  host: r.host,
  action: r.action,
  state: r.state,
  requestedAt: r.requested_at,
  finishedAt: r.finished_at,
  exitCode: r.exit_code,
  refusal: r.refusal,
  verified: r.verified,
});

export function createServeurActions(sql: Sql) {
  return {
    /** My button: a request waiting for confirmation, with its single-use token. */
    async request(
      findingId: number,
      host: string,
      action: ServerAction,
      now: Date,
    ): Promise<{ id: number; token: string } | null> {
      const token = randomBytes(8).toString("hex");
      const until = new Date(now.getTime() + CONFIRM_SECONDS * 1000);
      const rows = await sql<{ id: string }[]>`
        insert into serveur_actions
          (finding_id, host, action, state, confirm_token, requested_at, confirm_until)
        values (${findingId}, ${host}, ${action}, 'demandee', ${token}, ${now}, ${until})
        on conflict do nothing
        returning id`;
      const id = rows[0]?.id;
      return id === undefined ? null : { id: Number(id), token };
    },

    /** My confirmation: only with its token, only within its 60 seconds, only once. */
    async confirm(id: number, token: string, now: Date): Promise<ConfirmOutcome> {
      if (!TOKEN.test(token)) return "stale";
      const done = await sql`
        update serveur_actions
        set state = 'confirmee', confirmed_at = ${now}, confirm_token = null
        where id = ${id} and confirm_token = ${token} and state = 'demandee'
          and confirm_until >= ${now}`;
      if (done.count === 1) return "done";
      const [row] = await sql<{ state: ServerActionState; confirm_token: string | null }[]>`
        select state, confirm_token from serveur_actions where id = ${id}`;
      if (row === undefined) return "stale";
      if (row.state === "expiree" || (row.state === "demandee" && row.confirm_token === token)) {
        return "expired";
      }
      return row.confirm_token === null && row.state !== "demandee" ? "already" : "stale";
    },

    /** Requests not confirmed in time: nothing will be done. */
    async expire(now: Date): Promise<number> {
      const done = await sql`
        update serveur_actions
        set state = 'expiree', confirm_token = null, finished_at = ${now}
        where state = 'demandee' and confirm_until < ${now}`;
      return done.count;
    },

    /** The oldest confirmed request. */
    async next(): Promise<StoredServerAction | null> {
      const rows = await sql<Row[]>`
        select ${sql.unsafe(COLUMNS)} from serveur_actions
        where state = 'confirmee' order by confirmed_at, id limit 1`;
      return rows[0] === undefined ? null : toAction(rows[0]);
    },

    /** Taken for running — refused while another action runs, on any machine. */
    async claim(id: number, now: Date): Promise<boolean> {
      try {
        const done = await sql`
          update serveur_actions set state = 'en_cours', started_at = ${now}
          where id = ${id} and state = 'confirmee'`;
        return done.count === 1;
      } catch (error) {
        if ((error as { code?: string }).code === "23505") return false;
        throw error;
      }
    },

    /** The operator refused before acting (the switch, a stale verdict, an unknown machine…). */
    async refuse(id: number, refusal: string, now: Date): Promise<boolean> {
      const done = await sql`
        update serveur_actions
        set state = 'refusee', refusal = ${refusal}, finished_at = ${now}, told = false
        where id = ${id} and state in ('confirmee', 'en_cours')`;
      return done.count === 1;
    },

    async finish(id: number, state: FinalState, exitCode: number, now: Date): Promise<boolean> {
      if (!FINAL.includes(state) || state === "refusee" || state === "expiree") {
        throw new Error(`not an outcome of a run: ${state}`);
      }
      const done = await sql`
        update serveur_actions
        set state = ${state}, exit_code = ${exitCode}, finished_at = ${now}, told = false
        where id = ${id} and state = 'en_cours'`;
      return done.count === 1;
    },

    /** A run that never finished (the operator stopped mid-run): failed, said, and the way freed. */
    async abandonStale(now: Date): Promise<number> {
      const before = new Date(now.getTime() - STALE_RUN_MINUTES * 60_000);
      const done = await sql`
        update serveur_actions
        set state = 'echouee', exit_code = -1, finished_at = ${now}, told = false
        where state = 'en_cours' and started_at < ${before}`;
      return done.count;
    },

    /** Done, not yet compared with a later verdict of Legion. */
    async toVerify(): Promise<StoredServerAction[]> {
      const rows = await sql<Row[]>`
        select ${sql.unsafe(COLUMNS)} from serveur_actions
        where state = 'faite' and verified is null order by id`;
      return rows.map(toAction);
    },

    async verify(id: number, verified: Verified, now: Date): Promise<boolean> {
      const done = await sql`
        update serveur_actions set verified = ${verified}, verified_at = ${now}, told = false
        where id = ${id} and state = 'faite' and verified is null`;
      return done.count === 1;
    },

    /** Outcomes and proofs not told yet: told once the message has left. */
    async toTell(): Promise<StoredServerAction[]> {
      const rows = await sql<Row[]>`
        select ${sql.unsafe(COLUMNS)} from serveur_actions
        where told = false and state = any(${FINAL as string[]}::text[]) order by id`;
      return rows.map(toAction);
    },

    async markTold(ids: readonly number[]): Promise<void> {
      if (ids.length === 0) return;
      await sql`update serveur_actions set told = true where id = any(${ids as number[]}::bigint[])`;
    },

    /** 365 days after the request, the row goes. */
    async purge(now: Date): Promise<number> {
      const before = new Date(now.getTime() - ACTIONS_DAYS * 86_400_000);
      const done = await sql`
        delete from serveur_actions
        where requested_at < ${before} and state not in ('demandee', 'confirmee', 'en_cours')`;
      return done.count;
    },
  };
}

export type ServeurActions = ReturnType<typeof createServeurActions>;
