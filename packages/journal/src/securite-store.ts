/**
 * The security agent's findings (J6, ADR-0025), followed over time: a plan
 * from the lifecycle is applied in one transaction; a finding is marked
 * "signaled" only once its message has really left ("fetching is not
 * hearing", Legion); an accepted risk keeps its reason and date. No personal
 * data. Purged here: closed findings 365 days after closing, accepted ones
 * 90 days after acceptance, refused ones 30 days after the decision (each is
 * asked again). My decisions from Telegram: securite-decisions.ts.
 */
import type { Sql } from "postgres";

type Severity = "info" | "faible" | "moyen" | "eleve" | "critique";
export type FindingStatus =
  | "candidat"
  | "ouvert"
  | "pris_en_charge"
  | "resolu"
  | "accepte"
  | "refuse"
  | "caduc";
type Status = FindingStatus;

export interface SeenFinding {
  readonly check: string;
  readonly type: string;
  readonly target: string;
  readonly occurrence: string;
  readonly severity: Severity;
  readonly title: string;
  readonly params?: Readonly<Record<string, string>>;
}

export interface FindingPlan {
  readonly insert: readonly SeenFinding[];
  readonly promote: readonly { readonly id: number; readonly seen: SeenFinding }[];
  readonly touch: readonly { readonly id: number; readonly seen: SeenFinding }[];
  readonly resolve: readonly number[];
  readonly drop: readonly number[];
}

export interface StoredFinding {
  readonly id: number;
  readonly check: string;
  readonly type: string;
  readonly target: string;
  readonly occurrence: string;
  readonly severity: Severity;
  readonly title: string;
  readonly params: Readonly<Record<string, string>>;
  readonly status: Status;
  readonly firstSeen: Date;
  readonly lastSeen: Date;
  readonly closedAt: Date | null;
  readonly reason: string | null;
  readonly acceptedAt: Date | null;
  /** When I took it in hand or refused it (J6b). */
  readonly decidedAt: Date | null;
  /** A fix the agent prepares on my request (J6c), and its pull request. */
  readonly actionState: ActionState | null;
  readonly actionPrUrl: string | null;
  /** The commit the CI tested when the merge buttons were sent (J6d). */
  readonly actionHeadSha: string | null;
  /** Prepared under a delegation, not on my 🔧 (J6d). */
  readonly actionDelegated: boolean;
}

export type ActionState =
  | "demandee"
  | "pr_ouverte"
  | "ci_echouee"
  | "abandonnee"
  | "echouee"
  | "ci_verte"
  | "fusion_demandee"
  | "fermeture_demandee"
  | "fusionnee"
  | "fermee";

/** The trust record's counts for one delegable action, from the journal (J6d). */
export interface ActionCounts {
  readonly prepared: number;
  readonly mergedClean: number;
  readonly mergedEdited: number;
  readonly closed: number;
  readonly ciFailed: number;
}

export const CLOSED_KEEP_DAYS = 365;
export const ACCEPTED_ASK_AGAIN_DAYS = 90;
export const REFUSED_ASK_AGAIN_DAYS = 30;

export interface SecuriteStore {
  /** Every finding not closed: what the lifecycle compares with. */
  active(): Promise<StoredFinding[]>;
  apply(plan: FindingPlan, now: Date): Promise<void>;
  /** Opened and not yet told; resolved after having been told open, not yet told resolved. */
  toSignal(): Promise<{ opened: StoredFinding[]; resolved: StoredFinding[] }>;
  markSignaled(opened: readonly number[], resolved: readonly number[]): Promise<void>;
  /** Open, or taken in hand: what is still to fix. */
  open(): Promise<StoredFinding[]>;
  accepted(): Promise<StoredFinding[]>;
  /** I take the risk of a finding still to fix. False when there is none such. */
  accept(id: number, reason: string, now: Date): Promise<boolean>;
  purge(now: Date): Promise<number>;
  /** Fixes I asked for (🔧) and the agent has not prepared yet. */
  pendingFixes(): Promise<StoredFinding[]>;
  /** Pull requests opened by the agent, still followed (their CI, my merge or closing). */
  openPullRequests(): Promise<StoredFinding[]>;
  /** Where a requested fix stands; the PR's link once opened; the commit the CI tested. */
  setAction(id: number, state: ActionState, prUrl?: string, headSha?: string): Promise<void>;
  /** What I asked from the PR buttons (J6d): a merge or a closing, for the next round. */
  prRequests(): Promise<StoredFinding[]>;
  /** A delegation prepares this fix by itself: only an open finding with no action yet. */
  delegateFix(id: number, now: Date): Promise<boolean>;
  /** The trust record of a delegable action: the outcomes journaled since then. */
  actionCounts(delegable: string, since: Date): Promise<ActionCounts>;
}

interface Row {
  id: string;
  check_name: string;
  type: string;
  target: string;
  occurrence: string;
  severity: Severity;
  title: string;
  params: Record<string, string>;
  status: Status;
  first_seen: Date;
  last_seen: Date;
  closed_at: Date | null;
  reason: string | null;
  accepted_at: Date | null;
  decided_at: Date | null;
  action_state: ActionState | null;
  action_pr_url: string | null;
  action_head_sha: string | null;
  action_delegated: boolean;
}

const COLUMNS = `id, check_name, type, target, occurrence, severity, title, params, status,
  first_seen, last_seen, closed_at, reason, accepted_at, decided_at, action_state, action_pr_url,
  action_head_sha, action_delegated`;

const finding = (r: Row): StoredFinding => ({
  id: Number(r.id),
  check: r.check_name,
  type: r.type,
  target: r.target,
  occurrence: r.occurrence,
  severity: r.severity,
  title: r.title,
  params: r.params ?? {},
  status: r.status,
  firstSeen: r.first_seen,
  lastSeen: r.last_seen,
  closedAt: r.closed_at,
  reason: r.reason,
  acceptedAt: r.accepted_at,
  decidedAt: r.decided_at,
  actionState: r.action_state,
  actionPrUrl: r.action_pr_url,
  actionHeadSha: r.action_head_sha,
  actionDelegated: r.action_delegated,
});

const DAY_MS = 24 * 3_600_000;

export function createSecuriteStore(sql: Sql): SecuriteStore {
  // `where` is always one of the fixed strings below, never a value.
  const select = async (where: string) =>
    (
      await sql.unsafe<Row[]>(`select ${COLUMNS} from securite_constats where ${where} order by id`)
    ).map(finding);
  return {
    active: () => select("status not in ('resolu', 'caduc')"),

    async apply(plan, now) {
      await sql.begin(async (tx) => {
        for (const o of plan.insert) {
          await tx`
            insert into securite_constats
              (type, target, occurrence, check_name, severity, title, params, status, first_seen, last_seen)
            values (${o.type}, ${o.target}, ${o.occurrence}, ${o.check}, ${o.severity}, ${o.title},
                    ${tx.json(o.params ?? {})}, 'candidat', ${now}, ${now})`;
        }
        for (const { id, seen } of [...plan.promote, ...plan.touch]) {
          await tx`
            update securite_constats
            set status = case when status = 'candidat' then 'ouvert' else status end,
                severity = ${seen.severity}, title = ${seen.title}, params = ${tx.json(seen.params ?? {})},
                last_seen = ${now}, seen_count = seen_count + 1
            where id = ${id} and status not in ('resolu', 'caduc')`;
        }
        if (plan.resolve.length > 0) {
          await tx`
            update securite_constats set status = 'resolu', closed_at = ${now}, button_token = null
            where id = any(${plan.resolve as number[]}::bigint[])
              and status in ('ouvert', 'pris_en_charge')`;
        }
        if (plan.drop.length > 0) {
          await tx`
            update securite_constats set status = 'caduc', closed_at = ${now}
            where id = any(${plan.drop as number[]}::bigint[]) and status = 'candidat'`;
        }
      });
    },

    async toSignal() {
      return {
        opened: await select("status = 'ouvert' and not signaled_open"),
        resolved: await select("status = 'resolu' and signaled_open and not signaled_close"),
      };
    },

    async markSignaled(opened, resolved) {
      if (opened.length > 0) {
        await sql`update securite_constats set signaled_open = true
                  where id = any(${opened as number[]}::bigint[])`;
      }
      if (resolved.length > 0) {
        await sql`update securite_constats set signaled_close = true
                  where id = any(${resolved as number[]}::bigint[])`;
      }
    },

    open: () => select("status in ('ouvert', 'pris_en_charge')"),
    pendingFixes: () =>
      select("status in ('ouvert', 'pris_en_charge') and action_state = 'demandee'"),
    openPullRequests: () => select("action_state in ('pr_ouverte', 'ci_verte')"),
    prRequests: () => select("action_state in ('fusion_demandee', 'fermeture_demandee')"),

    async setAction(id, state, prUrl, headSha) {
      await sql`
        update securite_constats
        set action_state = ${state}, action_pr_url = coalesce(${prUrl ?? null}, action_pr_url),
            action_head_sha = coalesce(${headSha ?? null}, action_head_sha)
        where id = ${id}`;
    },

    async delegateFix(id, now) {
      const result = await sql`
        update securite_constats
        set status = 'pris_en_charge', decided_at = coalesce(decided_at, ${now}),
            action_state = 'demandee', action_requested_at = ${now}, action_delegated = true
        where id = ${id} and status = 'ouvert' and action_state is null
          and type = 'npm_advisory' and params ? 'fixName' and params ? 'fixVersion'`;
      return result.count === 1;
    },

    async actionCounts(delegable, since) {
      const rows = await sql<{ outcome: string; n: number }[]>`
        select payload->>'outcome' as outcome, count(*)::int as n from events
        where agent = 'securite' and type = 'securite.action'
          and payload->>'delegable' = ${delegable} and occurred_at >= ${since}
        group by 1`;
      const n = (outcome: string) => rows.find((r) => r.outcome === outcome)?.n ?? 0;
      return {
        prepared: n("pr_opened"),
        mergedClean: n("merged_clean"),
        mergedEdited: n("merged_edited"),
        closed: n("closed"),
        ciFailed: n("ci_failed"),
      };
    },
    accepted: () => select("status = 'accepte'"),

    async accept(id, reason, now) {
      const why = reason.replace(/\s+/g, " ").trim();
      if (why.length < 3 || why.length > 200) {
        throw new Error("a reason of 3 to 200 characters is needed");
      }
      const result = await sql`
        update securite_constats
        set status = 'accepte', reason = ${why}, accepted_at = ${now}, button_token = null
        where id = ${id} and status in ('ouvert', 'pris_en_charge')`;
      return result.count === 1;
    },

    async purge(now) {
      const closed = new Date(now.getTime() - CLOSED_KEEP_DAYS * DAY_MS);
      const accepted = new Date(now.getTime() - ACCEPTED_ASK_AGAIN_DAYS * DAY_MS);
      const refused = new Date(now.getTime() - REFUSED_ASK_AGAIN_DAYS * DAY_MS);
      const result = await sql`
        delete from securite_constats
        where (status in ('resolu', 'caduc') and closed_at < ${closed})
           or (status = 'accepte' and accepted_at < ${accepted})
           or (status = 'refuse' and decided_at < ${refused})`;
      return result.count;
    },
  };
}
