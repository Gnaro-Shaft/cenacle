/**
 * What the Parc tab reads in the base (14/11): the security findings still
 * open, the security agent's last round, the sentinel's last word. Read-only,
 * with the application's role (it may already read all of it), and only safe
 * columns: never a finding's button token, its action, its PR or its params.
 */
import type { Sql } from "postgres";
import { latestEvent } from "./journal.ts";

export type FindingSeverity = "critique" | "eleve" | "moyen" | "faible" | "info";
const SEVERITIES: readonly string[] = ["critique", "eleve", "moyen", "faible", "info"];
/** At most this many open findings listed (the counts are always whole). */
export const MAX_LISTED = 40;

export interface OpenFinding {
  readonly severity: FindingSeverity;
  /** In charge (being fixed), or still open. */
  readonly inCharge: boolean;
  readonly title: string;
  readonly since: Date;
}

export interface ParcFindings {
  readonly open: readonly OpenFinding[];
  /** Open findings by severity, all of them (the list may be cut). */
  readonly counts: Readonly<Record<FindingSeverity, number>>;
  /** Set aside, still followed: a risk I accepted, a fix I refused. */
  readonly setAside: number;
}

export interface LastRound {
  readonly at: Date;
  readonly checks: number;
  readonly impossible: number;
  readonly network: boolean;
}

export interface SentinelWord {
  readonly up: boolean;
  readonly since: Date;
}

export interface ParcStore {
  findings(): Promise<ParcFindings>;
  lastRound(): Promise<LastRound | null>;
  sentinel(): Promise<SentinelWord | null>;
}

const count = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;

export function createParcStore(sql: Sql): ParcStore {
  return {
    async findings() {
      const rows = await sql<{ severity: string; status: string; title: string; since: Date }[]>`
        select severity, status, left(title, 200) as title, first_seen as since
          from securite_constats
         where closed_at is null and status in ('ouvert', 'pris_en_charge', 'accepte', 'refuse')`;
      const counts: Record<FindingSeverity, number> = {
        critique: 0,
        eleve: 0,
        moyen: 0,
        faible: 0,
        info: 0,
      };
      const open: OpenFinding[] = [];
      let setAside = 0;
      for (const row of rows) {
        if (!SEVERITIES.includes(row.severity)) continue;
        if (row.status === "accepte" || row.status === "refuse") {
          setAside++;
          continue;
        }
        const severity = row.severity as FindingSeverity;
        counts[severity]++;
        open.push({
          severity,
          inCharge: row.status === "pris_en_charge",
          title: row.title,
          since: row.since,
        });
      }
      open.sort(
        (a, b) =>
          SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
          a.since.getTime() - b.since.getTime(),
      );
      return { open: open.slice(0, MAX_LISTED), counts, setAside };
    },

    async lastRound() {
      const event = await latestEvent(sql, "securite", ["securite.ran"]);
      if (event === undefined) return null;
      const p = event.payload as Record<string, unknown>;
      return {
        at: event.occurredAt,
        checks: count(p.checks),
        impossible: count(p.impossible),
        network: p.network === true,
      };
    },

    async sentinel() {
      const event = await latestEvent(sql, "sentinel", [
        "sentinel.link",
        "sentinel.reached",
        "sentinel.unreachable",
      ]);
      if (event === undefined) return null;
      const up =
        event.type === "sentinel.reached" ||
        (event.type === "sentinel.link" && (event.payload as Record<string, unknown>).up === true);
      return { up, since: event.occurredAt };
    },
  };
}
