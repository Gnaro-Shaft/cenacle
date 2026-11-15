/**
 * My decisions on the security agent's findings, from Telegram (J6b,
 * ADR-0025). A finding offered with buttons carries a random single-use
 * token: a decision applies only with that token, and only to a finding
 * still to fix — checked and written in one statement, so a forged, replayed
 * or stale button, or a double tap, changes nothing. Keeping a risk takes a
 * reason, given only as a direct reply to the bot's question, before its
 * deadline. Decisions are written before anything is answered.
 */
import { randomBytes } from "node:crypto";
import { ConfirmationFieldError, type MergeConfirmation } from "@cenacle/core";
import type { Sql } from "postgres";

export type Decision = "take" | "refuse";
export type DecisionOutcome = "done" | "stale" | "already";
/** "treated": a CERT-FR bulletin, closed by ✅ — no check can see it applied (J6e3). */
export type DecideOutcome = DecisionOutcome | "treated";
export type FixOutcome = DecisionOutcome | "not_fixable";
/**
 * "moved": the pull request is no longer on the commit my button showed.
 * "unsigned": the bot could not sign it (a field it cannot pin down).
 */
export type PrOutcome = "done" | "stale" | "not_ready" | "moved" | "unsigned";

/**
 * What a PR button asks. A merge carries the start of the commit the message
 * showed, and the bot's signer (ADR-0036, second step): without both, nothing.
 */
export type PrRequest =
  | { readonly action: "close" }
  | {
      readonly action: "merge";
      /** 12 hex characters: the commit as my button knew it. */
      readonly shown: string;
      /** Throws rather than sign a field it cannot pin down. */
      readonly sign: (f: MergeConfirmation) => string;
    };
export type ReasonOutcome = "done" | "expired" | "unknown" | "already";

export interface SecuriteDecisions {
  /** A token per finding still to fix, created once, kept until it is used. */
  tokens(ids: readonly number[]): Promise<Map<number, string>>;
  /** Whether this button may still act on this finding (keeping a risk, step 1). */
  check(id: number, token: string): Promise<DecisionOutcome>;
  /** ✅ "I'm on it" or ❌ "refused": applied once, with the right token only. */
  decide(id: number, token: string, decision: Decision, now: Date): Promise<DecideOutcome>;
  /**
   * 🔧 Prepare the pull request (J6c): only a dependency finding with a fix
   * version, still to fix; the agent's next round does it. Taken in hand meanwhile.
   */
  requestFix(id: number, token: string, now: Date): Promise<FixOutcome>;
  /**
   * ✅ Fusionner / ❌ Fermer under an agent's pull request, CI green (J6d): only
   * then, with the finding's token; the next round does it, after checking again.
   * A merge is signed here, with the very commit my button showed, or not asked.
   */
  requestPr(id: number, token: string, request: PrRequest, now: Date): Promise<PrOutcome>;
  /** The bot asked for a reason with this message: only a reply to it counts. */
  askReason(promptMessageId: number, findingId: number, expiresAt: Date): Promise<void>;
  /** The reply that gives the reason: keeps the risk if the question still stands. */
  giveReason(promptMessageId: number, reason: string, now: Date): Promise<ReasonOutcome>;
  /** Whether this message is a question still waiting for its reason. */
  isAsking(promptMessageId: number, now: Date): Promise<boolean>;
  /** Questions past their deadline. Returns how many. */
  purge(now: Date): Promise<number>;
}

const TOKEN = /^[0-9a-f]{16}$/;
/** The commit as a merge button carries it. */
const SHOWN = /^[0-9a-f]{12}$/;
const TO_FIX = ["ouvert", "pris_en_charge"];

export function createSecuriteDecisions(sql: Sql): SecuriteDecisions {
  async function check(id: number, token: string): Promise<DecisionOutcome> {
    if (!TOKEN.test(token)) return "stale";
    const [row] = await sql<{ status: string; button_token: string | null }[]>`
      select status, button_token from securite_constats where id = ${id}`;
    if (row === undefined) return "stale";
    if (!TO_FIX.includes(row.status)) return "already";
    return row.button_token === token ? "done" : "stale";
  }

  return {
    check,

    async tokens(ids) {
      const out = new Map<number, string>();
      for (const id of ids) {
        const fresh = randomBytes(8).toString("hex");
        const [row] = await sql<{ button_token: string }[]>`
          update securite_constats set button_token = coalesce(button_token, ${fresh})
          where id = ${id} and status = any(${TO_FIX}::text[])
          returning button_token`;
        if (row !== undefined) out.set(id, row.button_token);
      }
      return out;
    },

    async decide(id, token, decision, now) {
      if (!TOKEN.test(token)) return "stale";
      if (decision === "take") {
        // A bulletin: ✅ means done. Quiet for this bulletin, like a kept risk (J6e3).
        const treated = await sql`
          update securite_constats
          set status = 'accepte', reason = 'Traité (✅)', accepted_at = ${now},
              decided_at = ${now}, button_token = null
          where id = ${id} and button_token = ${token} and status = 'ouvert'
            and type in ('bulletin_alerte', 'bulletin_avis')`;
        if (treated.count === 1) return "treated";
      }
      const result =
        decision === "take"
          ? await sql`
              update securite_constats set status = 'pris_en_charge', decided_at = ${now}
              where id = ${id} and button_token = ${token} and status = 'ouvert'`
          : await sql`
              update securite_constats
              set status = 'refuse', decided_at = ${now}, button_token = null
              where id = ${id} and button_token = ${token} and status = any(${TO_FIX}::text[])`;
      if (result.count === 1) return "done";
      // Nothing changed: either a bad button, or the decision was already made.
      const state = await check(id, token);
      return state === "done" ? "already" : state;
    },

    async requestFix(id, token, now) {
      if (!TOKEN.test(token)) return "stale";
      const state = await check(id, token);
      if (state !== "done") return state;
      const result = await sql`
        update securite_constats
        set status = 'pris_en_charge', decided_at = coalesce(decided_at, ${now}),
            action_state = 'demandee', action_requested_at = ${now}
        where id = ${id} and button_token = ${token} and status = any(${TO_FIX}::text[])
          and type = 'npm_advisory' and params ? 'fixName' and params ? 'fixVersion'
          and (action_state is null or action_state in ('echouee', 'abandonnee'))`;
      if (result.count === 1) return "done";
      const [row] = await sql<{ type: string; action_state: string | null }[]>`
        select type, action_state from securite_constats where id = ${id}`;
      return row?.type === "npm_advisory" && row.action_state !== null ? "already" : "not_fixable";
    },

    async requestPr(id, token, request, now) {
      if (!TOKEN.test(token)) return "stale";
      const asked = await sql.begin(async (tx) => {
        const [row] = await tx<{ action_pr_url: string | null; action_head_sha: string | null }[]>`
          select action_pr_url, action_head_sha from securite_constats
          where id = ${id} and button_token = ${token} and action_state = 'ci_verte'
          for update`;
        if (row === undefined) return null;
        if (request.action === "close") {
          await tx`
            update securite_constats
            set action_state = 'fermeture_demandee', action_requested_at = ${now},
                merge_sig = null, merge_confirmed_at = null
            where id = ${id}`;
          return "done" as const;
        }
        const sha = row.action_head_sha;
        if (!SHOWN.test(request.shown) || sha === null || !sha.startsWith(request.shown)) {
          return "moved" as const;
        }
        let signature: string;
        try {
          signature = request.sign({
            findingId: id,
            prUrl: row.action_pr_url ?? "",
            headSha: sha,
            confirmedAt: now,
          });
        } catch (error) {
          if (error instanceof ConfirmationFieldError) return "unsigned" as const;
          throw error;
        }
        await tx`
          update securite_constats
          set action_state = 'fusion_demandee', action_requested_at = ${now},
              merge_sig = ${signature}, merge_confirmed_at = ${now}
          where id = ${id}`;
        return "done" as const;
      });
      if (asked !== null) return asked;
      const [row] = await sql<{ button_token: string | null }[]>`
        select button_token from securite_constats where id = ${id}`;
      return row?.button_token === token ? "not_ready" : "stale";
    },

    async askReason(promptMessageId, findingId, expiresAt) {
      await sql`
        insert into securite_raisons (prompt_message_id, finding_id, expires_at)
        values (${promptMessageId}, ${findingId}, ${expiresAt})
        on conflict (prompt_message_id) do nothing`;
    },

    async isAsking(promptMessageId, now) {
      const [row] = await sql`
        select 1 from securite_raisons
        where prompt_message_id = ${promptMessageId} and expires_at > ${now}`;
      return row !== undefined;
    },

    async giveReason(promptMessageId, reason, now) {
      const why = reason.replace(/\s+/g, " ").trim();
      if (why.length < 3 || why.length > 200) {
        throw new Error("a reason of 3 to 200 characters is needed");
      }
      return sql.begin(async (tx) => {
        const [asked] = await tx<{ finding_id: string; expires_at: Date }[]>`
          delete from securite_raisons where prompt_message_id = ${promptMessageId}
          returning finding_id, expires_at`;
        if (asked === undefined) return "unknown" as const;
        if (asked.expires_at.getTime() <= now.getTime()) return "expired" as const;
        const result = await tx`
          update securite_constats
          set status = 'accepte', reason = ${why}, accepted_at = ${now}, button_token = null
          where id = ${asked.finding_id} and status = any(${TO_FIX}::text[])`;
        return result.count === 1 ? ("done" as const) : ("already" as const);
      });
    },

    async purge(now) {
      const result = await sql`delete from securite_raisons where expires_at <= ${now}`;
      return result.count;
    },
  };
}
