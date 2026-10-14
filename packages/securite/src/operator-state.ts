/**
 * The operator's state, said to the security agent (ADR-0027, revised
 * 2026-10-14): from 12 to 14 October serveurs.local.toml refused every action
 * and nothing told, because the operator speaks only when asked. Now it leaves
 * a small file at each pass — when, and whether its list of machines can be
 * used — and the security agent, which may not read that list itself, turns a
 * blocked or silent operator into a finding. Only the kind of problem goes in
 * the file: never an address, a path or a machine name.
 */
import { SERVERS_CONFIG_PROBLEMS, type ServersConfigProblem } from "./servers.ts";
import type { Observation } from "./types.ts";

/** Where the operator leaves its state; read by the security agent. */
export const OPERATOR_STATE_PATH =
  process.env.OPERATOR_STATE_PATH ??
  `${process.env.HOME ?? ""}/Library/Caches/fr.gnaro.cenacle.operateur.etat`;

/** The operator passes every minute: ten missed passes, and it is silent. */
export const OPERATOR_SILENCE_MS = 10 * 60_000;
const FUTURE_TOLERANCE_MS = 5 * 60_000;

export type OperatorConfig = "ok" | ServersConfigProblem;

export interface OperatorState {
  readonly instantMs: number;
  readonly config: OperatorConfig;
}

export function formatOperatorState(s: OperatorState): string {
  return `instant=${Math.floor(s.instantMs / 1000)}\nconfig=${s.config}\nfin=1\n`;
}

/** Strict: exactly the three lines, in order; anything else is null. */
export function parseOperatorState(text: string): OperatorState | null {
  const m = /^instant=(\d{1,12})\nconfig=([a-z_]{1,20})\nfin=1\n?$/.exec(text);
  if (m === null) return null;
  const config = m[2] ?? "";
  if (config !== "ok" && !(SERVERS_CONFIG_PROBLEMS as readonly string[]).includes(config)) {
    return null;
  }
  return { instantMs: Number(m[1]) * 1000, config: config as OperatorConfig };
}

/** In plain words, for the finding's title. */
const PROBLEM_LABEL: Readonly<Record<ServersConfigProblem, string>> = {
  absent: "fichier absent",
  toml: "pas un TOML valide",
  racine: "clé inattendue au premier niveau",
  trop: "plus de 20 machines",
  bloc: "bloc [[serveur]] invalide",
  cle_inconnue: "clé inconnue dans un bloc [[serveur]]",
  nom: "nom de machine invalide ou en double",
  adresse: "adresse invalide",
  compte: "compte invalide",
  cles: "bloc [[serveur]] sans table cles",
  action: "action hors du catalogue",
  partagee: "une même clé pour deux actions",
  chemin: "chemin de clé invalide",
};

const silent = (why: string): Observation => ({
  type: "operateur_silencieux",
  target: "operateur",
  occurrence: "-",
  severity: "eleve",
  title: `L'opérateur ne dit plus son état (${why}) : aucune action sur les serveurs ne partira`,
  params: {},
});

/**
 * What the security agent sees: nothing while the actions are switched off;
 * otherwise a silent operator (no state, an unreadable one, one from the
 * future, or older than ten minutes), or a blocked one, by kind.
 */
export function operatorObservations(
  text: string | null,
  switchOn: boolean,
  nowMs: number,
): Observation[] {
  if (!switchOn) return [];
  if (text === null) return [silent("aucun état publié")];
  const state = parseOperatorState(text);
  if (state === null || state.instantMs > nowMs + FUTURE_TOLERANCE_MS) {
    return [silent("état illisible")];
  }
  if (nowMs - state.instantMs > OPERATOR_SILENCE_MS) {
    return [silent("dernier état il y a plus de 10 minutes")];
  }
  if (state.config === "ok") return [];
  return [
    {
      type: "operateur_config",
      target: "serveurs.local.toml",
      occurrence: state.config,
      severity: "eleve",
      title: `Les actions sur les serveurs sont bloquées : l'opérateur refuse serveurs.local.toml (${PROBLEM_LABEL[state.config]})`,
      params: { problem: state.config },
    },
  ];
}
