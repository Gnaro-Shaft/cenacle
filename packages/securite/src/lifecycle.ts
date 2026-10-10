/**
 * Reconciling what was known with what the checks just saw (J6a; Legion's
 * propositions). Pure: the store applies the plan in one transaction.
 *  - Seen for the first time: a candidate, not reported (debounce: a passing
 *    glitch never wakes me up).
 *  - Seen again at a later run: open, and reported once.
 *  - Open, and no longer seen by a check that ran: resolved, reported once.
 *  - A candidate no longer seen: dropped quietly.
 *  - Taken in hand ("I'm on it", J6b): followed like an open finding.
 *  - Accepted (I took the risk) or refused (the proposal does not suit me):
 *    silent while the same occurrence is seen; a new occurrence is new.
 *  - A check that could not run closes nothing; it is itself a finding
 *    ("check_impossible"), resolved when the check runs again.
 */
import type { CheckResult, FindingKey, Observation, Severity } from "./types.ts";
import { keyOf } from "./types.ts";

export type ActiveStatus = "candidat" | "ouvert" | "pris_en_charge" | "accepte" | "refuse";

export interface ActiveFinding extends FindingKey {
  readonly id: number;
  readonly check: string;
  readonly status: ActiveStatus;
}

export interface SeenObservation extends Observation {
  readonly check: string;
}

export interface Plan {
  readonly insert: readonly SeenObservation[];
  readonly promote: readonly { readonly id: number; readonly seen: SeenObservation }[];
  readonly touch: readonly { readonly id: number; readonly seen: SeenObservation }[];
  readonly resolve: readonly number[];
  readonly drop: readonly number[];
}

/** Clearer words for the checks whose failure says something by itself. */
const IMPOSSIBLE_TITLE: Readonly<Record<string, string>> = {
  legion_ronde:
    "La ronde de Legion ne répond plus : verdict absent, périmé ou illisible — plus rien ne surveille les serveurs",
};

const impossible = (check: string): SeenObservation => ({
  check,
  type: "check_impossible",
  target: check,
  occurrence: "-",
  severity: (check === "legion_ronde" ? "eleve" : "moyen") as Severity,
  title: Object.hasOwn(IMPOSSIBLE_TITLE, check)
    ? (IMPOSSIBLE_TITLE[check] ?? "")
    : `Le contrôle « ${check} » n'a pas pu tourner`,
});

export function reconcile(active: readonly ActiveFinding[], results: readonly CheckResult[]): Plan {
  const seen = new Map<string, SeenObservation>();
  const ran = new Set<string>();
  for (const r of results) {
    if (r.ran) {
      ran.add(r.check);
      for (const o of r.observations) seen.set(keyOf(o), { ...o, check: r.check });
    } else {
      const o = impossible(r.check);
      seen.set(keyOf(o), o);
    }
  }
  const byKey = new Map(active.map((a) => [keyOf(a), a]));
  const plan = { insert: [], promote: [], touch: [], resolve: [], drop: [] } as {
    insert: SeenObservation[];
    promote: { id: number; seen: SeenObservation }[];
    touch: { id: number; seen: SeenObservation }[];
    resolve: number[];
    drop: number[];
  };
  for (const [key, o] of seen) {
    const known = byKey.get(key);
    if (known === undefined) plan.insert.push(o);
    else if (known.status === "candidat") plan.promote.push({ id: known.id, seen: o });
    else plan.touch.push({ id: known.id, seen: o });
  }
  for (const a of active) {
    if (seen.has(keyOf(a)) || a.status === "accepte" || a.status === "refuse") continue;
    // Only a check that really ran can say a situation is gone.
    if (!ran.has(a.check)) continue;
    if (a.status === "candidat") plan.drop.push(a.id);
    else plan.resolve.push(a.id);
  }
  return plan;
}
