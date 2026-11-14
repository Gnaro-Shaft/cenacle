/**
 * The Parc tab's words and states (14/11), pure: what a state is called, its
 * colour, how long ago, when a round is too old to be believed. Nothing here
 * ever shows a server as healthy when its verdict is missing or stale.
 */

export type Tone = "bon" | "attention" | "mauvais" | "inconnu";
export type LegionState = "SAIN" | "SOUFFRANT" | "MALADE";
export type Severity = "critique" | "eleve" | "moyen" | "faible" | "info";

export const SEVERITIES: readonly Severity[] = ["critique", "eleve", "moyen", "faible", "info"];

const STATE_LABEL: Readonly<Record<LegionState, string>> = {
  SAIN: "sain",
  SOUFFRANT: "souffrant",
  MALADE: "malade",
};
const STATE_TONE: Readonly<Record<LegionState, Tone>> = {
  SAIN: "bon",
  SOUFFRANT: "attention",
  MALADE: "mauvais",
};
const SEVERITY_LABEL: Readonly<Record<Severity, string>> = {
  critique: "critique",
  eleve: "élevé",
  moyen: "moyen",
  faible: "faible",
  info: "info",
};
const SEVERITY_TONE: Readonly<Record<Severity, Tone>> = {
  critique: "mauvais",
  eleve: "mauvais",
  moyen: "attention",
  faible: "inconnu",
  info: "inconnu",
};

export const stateLabel = (s: LegionState) => STATE_LABEL[s] ?? "inconnu";
/** A stale verdict says nothing of today: its servers are shown unknown, never healthy. */
export const stateTone = (s: LegionState, stale: boolean): Tone =>
  stale ? "inconnu" : (STATE_TONE[s] ?? "inconnu");
export const severityLabel = (s: Severity) => SEVERITY_LABEL[s] ?? s;
export const severityTone = (s: Severity): Tone => SEVERITY_TONE[s] ?? "inconnu";

/** « il y a 3 min », « il y a 2 h », « il y a 5 j »; a date ahead says « à l'instant ». */
export function ago(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "à une date inconnue";
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

/** The security agent runs every 15 min: past 40 min without a round, it is not watching. */
export const ROUND_LATE_MS = 40 * 60_000;
export const roundLate = (iso: string, now: number) => {
  const at = Date.parse(iso);
  return Number.isNaN(at) || now - at > ROUND_LATE_MS;
};

/** The whole park in one tone: the worst of what is known; unknown when the verdict is not. */
export function parkTone(
  servers: { readonly read: string; readonly stale?: boolean; readonly state?: LegionState },
  counts: Readonly<Record<Severity, number>>,
): Tone {
  if (servers.read !== "ok" || servers.stale === true || servers.state === undefined) {
    return "inconnu";
  }
  if (servers.state === "MALADE" || counts.critique > 0) return "mauvais";
  if (servers.state === "SOUFFRANT" || counts.eleve > 0 || counts.moyen > 0) return "attention";
  return "bon";
}
