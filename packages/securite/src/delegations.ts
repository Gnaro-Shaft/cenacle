/**
 * Delegations and the trust record (J6d, ADR-0026). The reward of an agent
 * that works well is autonomy — never retraining a model. A closed list of
 * delegable actions lives here; `securite.toml` (versioned, out of the
 * agent's reach) sets each one's threshold and, once I grant it, its date.
 * The trust record is counted by code from facts I produced (my merges, my
 * closings, my changes, the CI), never by the model. Merging is not in the
 * list, and never will be. Pure: every rule is testable.
 */
import { parse } from "smol-toml";

/** What may be delegated: preparing a fix's PR, never merging it. */
export const DELEGABLE = ["preparer_pr_npm"] as const;
export type Delegable = (typeof DELEGABLE)[number];

export const DELEGABLE_LABEL: Readonly<Record<Delegable, string>> = {
  preparer_pr_npm: "préparer la PR d'une faille npm (sans version majeure)",
};

export interface Delegation {
  readonly action: Delegable;
  /** Pull requests merged without any change of mine, before the CTO proposes it. */
  readonly seuil: number;
  /** When I granted it, if I did (local day, Paris). */
  readonly accordeeLe: string | null;
}

/** The outcomes of the agent's pull requests, counted from the journal. */
export interface TrustRecord {
  readonly prepared: number;
  readonly mergedClean: number;
  readonly mergedEdited: number;
  readonly closed: number;
  readonly ciFailed: number;
}

export type DelegationState = "apprentissage" | "proposable" | "accordee" | "suspendue";

export class DelegationConfigError extends Error {
  constructor(message: string) {
    super(`securite.toml: ${message}`);
    this.name = "DelegationConfigError";
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDelegations(source: string, today: string): Delegation[] {
  const raw = parse(source);
  for (const key of Object.keys(raw)) {
    if (key !== "delegation") throw new DelegationConfigError(`unknown key "${key}"`);
  }
  const list = raw.delegation ?? [];
  if (!Array.isArray(list)) throw new DelegationConfigError("[[delegation]] expected");
  const seen = new Set<string>();
  return list.map((entry, i) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new DelegationConfigError(`delegation ${i + 1} is not a table`);
    }
    const e = entry as Record<string, unknown>;
    for (const key of Object.keys(e)) {
      if (!["action", "seuil", "accordee_le"].includes(key)) {
        throw new DelegationConfigError(`unknown key "${key}" in delegation ${i + 1}`);
      }
    }
    if (!(DELEGABLE as readonly unknown[]).includes(e.action)) {
      throw new DelegationConfigError(
        `delegation ${i + 1}: "${String(e.action).slice(0, 40)}" is not delegable`,
      );
    }
    const action = e.action as Delegable;
    if (seen.has(action)) throw new DelegationConfigError(`"${action}" declared twice`);
    seen.add(action);
    const seuil = typeof e.seuil === "bigint" ? Number(e.seuil) : e.seuil;
    if (typeof seuil !== "number" || !Number.isInteger(seuil) || seuil < 1 || seuil > 100) {
      throw new DelegationConfigError(`${action}: seuil must be a whole number from 1 to 100`);
    }
    // smol-toml reads a bare date as a date object; a quoted one as text.
    const given =
      e.accordee_le === undefined
        ? null
        : String(
            e.accordee_le instanceof Date
              ? e.accordee_le.toISOString().slice(0, 10)
              : e.accordee_le,
          );
    if (given !== null && (!DATE.test(given) || Number.isNaN(Date.parse(given)))) {
      throw new DelegationConfigError(`${action}: accordee_le must be a date (YYYY-MM-DD)`);
    }
    if (given !== null && given > today) {
      throw new DelegationConfigError(`${action}: accordee_le is in the future`);
    }
    return { action, seuil, accordeeLe: given };
  });
}

/** A failure, for trust: CI red, closed without merging, or merged with a change of mine. */
export const failures = (t: TrustRecord) => t.closed + t.ciFailed + t.mergedEdited;

/**
 * Where a delegation stands. Granted: active unless suspended since its
 * grant. Not granted: proposable once the threshold of clean merges is
 * reached with no failure at all.
 */
export function delegationState(
  d: Delegation,
  trust: TrustRecord,
  suspendedOn: string | null,
): DelegationState {
  if (d.accordeeLe !== null) {
    return suspendedOn !== null && suspendedOn >= d.accordeeLe ? "suspendue" : "accordee";
  }
  return trust.mergedClean >= d.seuil && failures(trust) === 0 ? "proposable" : "apprentissage";
}

/** The fix a delegation may prepare by itself: a fixable advisory without a major version change. */
export function delegableFix(params: Readonly<Record<string, string>>): boolean {
  return params.fixMajor !== "1";
}
