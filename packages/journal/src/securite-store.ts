/**
 * The security agent's findings (J6, ADR-0025), followed over time: a plan
 * from the lifecycle is applied in one transaction; a finding is marked
 * "signaled" only once its message has really left ("fetching is not
 * hearing", Legion); an accepted risk keeps its reason and date. No personal
 * data. Purged here: closed findings 365 days after closing, accepted ones
 * 90 days after acceptance (the risk is asked again).
 */
import type { Sql } from "postgres";

type Severity = "info" | "faible" | "moyen" | "eleve" | "critique";
type Status = "candidat" | "ouvert" | "resolu" | "accepte" | "caduc";

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
}

export const CLOSED_KEEP_DAYS = 365;
export const ACCEPTED_ASK_AGAIN_DAYS = 90;

export interface SecuriteStore {
  /** Candidates, open findings and accepted risks: what the lifecycle compares with. */
  active(): Promise<StoredFinding[]>;
  apply(plan: FindingPlan, now: Date): Promise<void>;
  /** Opened and not yet told; resolved after having been told open, not yet told resolved. */
  toSignal(): Promise<{ opened: StoredFinding[]; resolved: StoredFinding[] }>;
  markSignaled(opened: readonly number[], resolved: readonly number[]): Promise<void>;
  open(): Promise<StoredFinding[]>;
  accepted(): Promise<StoredFinding[]>;
  /** I take the risk of an open finding. False when there is no such open finding. */
  accept(id: number, reason: string, now: Date): Promise<boolean>;
  purge(now: Date): Promise<number>;
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
}

const COLUMNS = `id, check_name, type, target, occurrence, severity, title, params, status,
  first_seen, last_seen, closed_at, reason, accepted_at`;

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
});

const DAY_MS = 24 * 3_600_000;

export function createSecuriteStore(sql: Sql): SecuriteStore {
  // `where` is always one of the fixed strings below, never a value.
  const select = async (where: string) =>
    (
      await sql.unsafe<Row[]>(`select ${COLUMNS} from securite_constats where ${where} order by id`)
    ).map(finding);
  return {
    active: () => select("status in ('candidat', 'ouvert', 'accepte')"),

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
            where id = ${id} and status in ('candidat', 'ouvert', 'accepte')`;
        }
        if (plan.resolve.length > 0) {
          await tx`
            update securite_constats set status = 'resolu', closed_at = ${now}
            where id = any(${plan.resolve as number[]}::bigint[]) and status = 'ouvert'`;
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

    open: () => select("status = 'ouvert'"),
    accepted: () => select("status = 'accepte'"),

    async accept(id, reason, now) {
      const why = reason.replace(/\s+/g, " ").trim();
      if (why.length < 3 || why.length > 200) {
        throw new Error("a reason of 3 to 200 characters is needed");
      }
      const result = await sql`
        update securite_constats set status = 'accepte', reason = ${why}, accepted_at = ${now}
        where id = ${id} and status = 'ouvert'`;
      return result.count === 1;
    },

    async purge(now) {
      const closed = new Date(now.getTime() - CLOSED_KEEP_DAYS * DAY_MS);
      const accepted = new Date(now.getTime() - ACCEPTED_ASK_AGAIN_DAYS * DAY_MS);
      const result = await sql`
        delete from securite_constats
        where (status in ('resolu', 'caduc') and closed_at < ${closed})
           or (status = 'accepte' and accepted_at < ${accepted})`;
      return result.count;
    },
  };
}
