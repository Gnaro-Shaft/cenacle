/**
 * The maintenance plans (ADR-0035, J7d), in the database: the summary proposes
 * one, with its steps; my "Valider" asks, my confirmation within 2 minutes
 * makes it run; the operator then launches its steps one at a time and settles
 * each. A newer summary replaces a plan I did not confirm. One plan runs at a
 * time, whatever happens — the database refuses a second. Every move is a
 * guarded update: a stale token, a late confirmation or a double tap changes
 * nothing.
 */
import { randomBytes } from "node:crypto";
import type { Sql } from "postgres";
import type { ServerAction } from "./serveur-actions.ts";

export type PlanState =
  | "proposee"
  | "a_confirmer"
  | "confirmee"
  | "en_cours"
  | "terminee"
  | "arretee"
  | "expiree"
  | "remplacee";
export type StepState =
  | "attente"
  | "retiree"
  | "lancee"
  | "faite"
  | "sautee"
  | "arretee"
  | "annulee";
export type PlanConfirmOutcome = "done" | "stale" | "expired" | "already" | "busy";

export interface PlanStep {
  readonly id: number;
  readonly position: number;
  readonly host: string;
  readonly action: ServerAction;
  /** "If needed": runs only if the verdict asks for it then. */
  readonly conditional: boolean;
  readonly state: StepState;
  /** The serveur_actions row it launched. */
  readonly actionId: number | null;
  readonly reason: string | null;
}
export interface StoredPlan {
  readonly id: number;
  readonly state: PlanState;
  readonly createdAt: Date;
  readonly confirmedAt: Date | null;
  readonly messageId: number | null;
  readonly steps: readonly PlanStep[];
}
export interface NewStep {
  readonly host: string;
  readonly action: ServerAction;
  readonly conditional: boolean;
}

/** How long a confirmation stays possible, as for an action (ADR-0027). */
export const PLAN_CONFIRM_SECONDS = 120;
/** A confirmed plan: what has not started within this is cancelled. */
export const PLAN_VALID_HOURS = 6;
export const PLANS_DAYS = 365;

const TOKEN = /^[0-9a-f]{16}$/;
const RUNNING: readonly PlanState[] = ["confirmee", "en_cours"];
const ENDED: readonly PlanState[] = ["terminee", "arretee", "expiree"];
const SETTLED: readonly StepState[] = ["faite", "sautee", "arretee"];
const REASON = /^[a-z_]{1,40}$/;

interface PlanRow {
  id: string;
  state: PlanState;
  created_at: Date;
  confirmed_at: Date | null;
  message_id: string | null;
}
interface StepRow {
  id: string;
  position: number;
  host: string;
  action: ServerAction;
  conditional: boolean;
  state: StepState;
  serveur_action_id: string | null;
  reason: string | null;
}

export function createPlanStore(sql: Sql) {
  async function load(row: PlanRow | undefined): Promise<StoredPlan | null> {
    if (row === undefined) return null;
    const steps = await sql<StepRow[]>`
      select id, position, host, action, conditional, state, serveur_action_id, reason
      from maintenance_etapes where plan_id = ${row.id} order by position`;
    return {
      id: Number(row.id),
      state: row.state,
      createdAt: row.created_at,
      confirmedAt: row.confirmed_at,
      messageId: row.message_id === null ? null : Number(row.message_id),
      steps: steps.map((s) => ({
        id: Number(s.id),
        position: s.position,
        host: s.host,
        action: s.action,
        conditional: s.conditional,
        state: s.state,
        actionId: s.serveur_action_id === null ? null : Number(s.serveur_action_id),
        reason: s.reason,
      })),
    };
  }

  return {
    /** The summary's plan, with its button token; it replaces any plan still unconfirmed. */
    async propose(steps: readonly NewStep[], now: Date): Promise<{ id: number; token: string }> {
      if (steps.length === 0 || steps.length > 100) throw new Error("a plan has 1 to 100 steps");
      const token = randomBytes(8).toString("hex");
      return sql.begin(async (tx) => {
        await tx`
          update maintenance_plans
          set state = 'remplacee', button_token = null, confirm_token = null
          where state in ('proposee', 'a_confirmer')`;
        const [row] = await tx<{ id: string }[]>`
          insert into maintenance_plans (state, created_at, button_token)
          values ('proposee', ${now}, ${token}) returning id`;
        const id = Number(row?.id);
        for (const [position, s] of steps.entries()) {
          await tx`
            insert into maintenance_etapes (plan_id, position, host, action, conditional, state)
            values (${id}, ${position}, ${s.host}, ${s.action}, ${s.conditional}, 'attente')`;
        }
        return { id, token };
      });
    },

    /** The summary's message, so its buttons can be taken away once used. */
    async setMessage(id: number, messageId: number): Promise<void> {
      await sql`update maintenance_plans set message_id = ${messageId} where id = ${id}`;
    },

    /** "Retirer": a machine's steps, or its reboot alone, out — only before I confirm. */
    async remove(
      id: number,
      token: string,
      host: string,
      action: "redemarrer" | null,
    ): Promise<boolean> {
      if (!TOKEN.test(token)) return false;
      const done = await sql`
        update maintenance_etapes e set state = 'retiree'
        from maintenance_plans p
        where e.plan_id = p.id and p.id = ${id} and p.button_token = ${token}
          and p.state in ('proposee', 'a_confirmer') and e.host = ${host} and e.state = 'attente'
          and (${action}::text is null or e.action = ${action})`;
      return done.count > 0;
    },

    /** "Valider": the single-use confirmation token, valid 2 minutes; null if nothing is left to do. */
    async ask(id: number, token: string, now: Date): Promise<string | null> {
      if (!TOKEN.test(token)) return null;
      const confirm = randomBytes(8).toString("hex");
      const until = new Date(now.getTime() + PLAN_CONFIRM_SECONDS * 1000);
      const done = await sql`
        update maintenance_plans p
        set state = 'a_confirmer', confirm_token = ${confirm}, confirm_until = ${until}
        where p.id = ${id} and p.button_token = ${token} and p.state in ('proposee', 'a_confirmer')
          and exists (select 1 from maintenance_etapes e where e.plan_id = p.id and e.state = 'attente')`;
      return done.count === 1 ? confirm : null;
    },

    /** My confirmation: only with its token, within its 2 minutes, once, and never beside a running plan. */
    async confirm(id: number, token: string, now: Date): Promise<PlanConfirmOutcome> {
      if (!TOKEN.test(token)) return "stale";
      try {
        const done = await sql`
          update maintenance_plans
          set state = 'confirmee', confirmed_at = ${now}, confirm_token = null, button_token = null
          where id = ${id} and confirm_token = ${token} and state = 'a_confirmer'
            and confirm_until >= ${now}`;
        if (done.count === 1) return "done";
      } catch (error) {
        if ((error as { code?: string }).code === "23505") return "busy";
        throw error;
      }
      const [row] = await sql<{ state: PlanState; confirm_token: string | null }[]>`
        select state, confirm_token from maintenance_plans where id = ${id}`;
      if (row === undefined || row.state === "remplacee") return "stale";
      if (row.state === "a_confirmer" && row.confirm_token === token) return "expired";
      return RUNNING.includes(row.state) || ENDED.includes(row.state) ? "already" : "stale";
    },

    async get(id: number): Promise<StoredPlan | null> {
      const [row] = await sql<PlanRow[]>`
        select id, state, created_at, confirmed_at, message_id from maintenance_plans
        where id = ${id}`;
      return load(row);
    },

    /** The plan the operator drives: confirmed or running, at most one. */
    async running(): Promise<StoredPlan | null> {
      const [row] = await sql<PlanRow[]>`
        select id, state, created_at, confirmed_at, message_id from maintenance_plans
        where state in ('confirmee', 'en_cours') limit 1`;
      return load(row);
    },

    async start(id: number): Promise<boolean> {
      const done = await sql`
        update maintenance_plans set state = 'en_cours' where id = ${id} and state = 'confirmee'`;
      return done.count === 1;
    },

    /** A step launched: the action it made. */
    async launch(stepId: number, actionId: number): Promise<boolean> {
      const done = await sql`
        update maintenance_etapes set state = 'lancee', serveur_action_id = ${actionId}
        where id = ${stepId} and state = 'attente'`;
      return done.count === 1;
    },

    /** A step settled: done, skipped (with why), or the one that stopped the plan. */
    async settle(
      stepId: number,
      state: "faite" | "sautee" | "arretee",
      reason: string | null,
    ): Promise<boolean> {
      if (!SETTLED.includes(state)) throw new Error(`not a settled step: ${state}`);
      if (reason !== null && !REASON.test(reason)) throw new Error("invalid reason");
      const done = await sql`
        update maintenance_etapes set state = ${state}, reason = ${reason}
        where id = ${stepId} and state in ('attente', 'lancee')`;
      return done.count === 1;
    },

    /** The plan's end: what had not started is cancelled. */
    async finish(
      id: number,
      state: "terminee" | "arretee" | "expiree",
      reason: string | null,
      now: Date,
    ): Promise<boolean> {
      if (!ENDED.includes(state)) throw new Error(`not an end: ${state}`);
      if (reason !== null && !REASON.test(reason)) throw new Error("invalid reason");
      return sql.begin(async (tx) => {
        const done = await tx`
          update maintenance_plans set state = ${state}, stop_reason = ${reason}, finished_at = ${now}
          where id = ${id} and state in ('confirmee', 'en_cours')`;
        if (done.count !== 1) return false;
        await tx`
          update maintenance_etapes set state = 'annulee' where plan_id = ${id} and state = 'attente'`;
        return true;
      });
    },

    /** 365 days after the plan, it goes with its steps; never a plan still to run. */
    async purge(now: Date): Promise<number> {
      const before = new Date(now.getTime() - PLANS_DAYS * 86_400_000);
      const done = await sql`
        delete from maintenance_plans
        where created_at < ${before} and state not in ('confirmee', 'en_cours')`;
      // Cascaded already; this only says the steps are purged with their plan.
      await sql`delete from maintenance_etapes where plan_id not in (select id from maintenance_plans)`;
      return done.count;
    },
  };
}

export type PlanStore = ReturnType<typeof createPlanStore>;
