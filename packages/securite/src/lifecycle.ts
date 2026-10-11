/**
 * Reconciling what was known with what the checks just saw (J6a; Legion's
 * propositions). Pure: the store applies the plan in one transaction.
 *  - Seen for the first time: a candidate, not reported (debounce: a passing
 *    glitch never wakes me up).
 *  - Seen again at least DEBOUNCE_MINUTES after its first sighting: open,
 *    and reported once. Seen again sooner (two rounds close together, a
 *    passing port): still a candidate.
 *  - Open, and no longer seen by a check that ran: resolved, reported once.
 *  - A candidate no longer seen: dropped quietly.
 *  - Taken in hand ("I'm on it", J6b): followed like an open finding.
 *  - Accepted (I took the risk) or refused (the proposal does not suit me):
 *    silent while the same occurrence is seen; a new occurrence is new.
 *  - A check that could not run closes nothing; it is itself a finding
 *    ("check_impossible"), resolved when the check runs again.
 *  - A CERT-FR advisory out of the feed is not "resolved" — nothing was
 *    fixed: it expires, quietly (J6e3).
 */
import type { CheckResult, FindingKey, Observation, Severity } from "./types.ts";
import { keyOf } from "./types.ts";

export type ActiveStatus = "candidat" | "ouvert" | "pris_en_charge" | "accepte" | "refuse";

export interface ActiveFinding extends FindingKey {
  readonly id: number;
  readonly check: string;
  readonly status: ActiveStatus;
  readonly firstSeen: Date;
}

/** The least time between the two sightings that open a finding (Legion's rule). */
export const DEBOUNCE_MINUTES = 10;
const DEBOUNCE_MS = DEBOUNCE_MINUTES * 60_000;

export interface SeenObservation extends Observation {
  readonly check: string;
}

export interface Plan {
  readonly insert: readonly SeenObservation[];
  readonly promote: readonly { readonly id: number; readonly seen: SeenObservation }[];
  readonly touch: readonly { readonly id: number; readonly seen: SeenObservation }[];
  readonly resolve: readonly number[];
  readonly drop: readonly number[];
  /** Open, gone, and nothing to tell: closed quietly (caduc). */
  readonly expire: readonly number[];
}

/** Kinds whose absence means "no longer current", never "fixed". */
export const EXPIRE_ON_ABSENCE: readonly string[] = ["bulletin_avis"];

/** Clearer words for the checks whose failure says something by itself. */
const IMPOSSIBLE_TITLE: Readonly<Record<string, string>> = {
  legion_ronde:
    "La ronde de Legion ne répond plus : verdict absent, périmé ou illisible — plus rien ne surveille les serveurs",
  certfr_alertes:
    "Les alertes du CERT-FR n'ont pas pu être lues (site injoignable, flux vide ou liste [bulletins] illisible)",
  certfr_avis:
    "Les avis du CERT-FR n'ont pas pu être lus (site injoignable, flux vide ou liste [bulletins] illisible)",
  projets:
    "La liste de tes projets (securite.local.toml) est illisible : aucun projet n'est contrôlé tant qu'elle n'est pas corrigée",
};

/** My other projects (J6e2): the check names say which project, in plain words. */
function impossibleTitle(check: string): string {
  if (Object.hasOwn(IMPOSSIBLE_TITLE, check)) return IMPOSSIBLE_TITLE[check] ?? "";
  const npm = /^npm_([a-z_]+)$/.exec(check);
  if (npm !== null && check !== "npm_audit" && check !== "npm_outdated") {
    return `L'audit des dépendances du projet « ${npm[1]} » n'a pas pu tourner (dossier introuvable, ou package-lock.json absent ?)`;
  }
  const leaks = /^fuites_([a-z_]+)$/.exec(check);
  if (leaks !== null) {
    return `La recherche de secrets dans le projet « ${leaks[1]} » n'a pas pu tourner (dossier introuvable, ou pas un dépôt git ?)`;
  }
  return `Le contrôle « ${check} » n'a pas pu tourner`;
}

const impossible = (check: string): SeenObservation => ({
  check,
  type: "check_impossible",
  target: check,
  occurrence: "-",
  severity: (check === "legion_ronde" ? "eleve" : "moyen") as Severity,
  title: impossibleTitle(check),
});

/** Long enough since the first sighting; a first sighting "in the future" never is. */
const settled = (f: ActiveFinding, now: Date): boolean =>
  now.getTime() - f.firstSeen.getTime() >= DEBOUNCE_MS;

export function reconcile(
  active: readonly ActiveFinding[],
  results: readonly CheckResult[],
  now: Date,
): Plan {
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
  const plan = { insert: [], promote: [], touch: [], resolve: [], drop: [], expire: [] } as {
    insert: SeenObservation[];
    promote: { id: number; seen: SeenObservation }[];
    touch: { id: number; seen: SeenObservation }[];
    resolve: number[];
    drop: number[];
    expire: number[];
  };
  for (const [key, o] of seen) {
    const known = byKey.get(key);
    if (known === undefined) plan.insert.push(o);
    else if (known.status === "candidat" && settled(known, now))
      plan.promote.push({ id: known.id, seen: o });
    else plan.touch.push({ id: known.id, seen: o });
  }
  for (const a of active) {
    if (seen.has(keyOf(a)) || a.status === "accepte" || a.status === "refuse") continue;
    // Only a check that really ran can say a situation is gone.
    if (!ran.has(a.check)) continue;
    if (a.status === "candidat") plan.drop.push(a.id);
    else if (EXPIRE_ON_ABSENCE.includes(a.type)) plan.expire.push(a.id);
    else plan.resolve.push(a.id);
  }
  return plan;
}
