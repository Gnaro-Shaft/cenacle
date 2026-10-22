/**
 * The board's words and rules, without React, so that they can be tested
 * (ADR-0032, points 14 to 20): the columns in order, why a card stopped, the
 * mark of what AI extracted, and which link may be clicked — https only,
 * whatever the server says (a second check, never the only one).
 */

export const COLUMNS = [
  ["detected", "Détectées"],
  ["direct", "Client direct"],
  ["profile", "Mon profil"],
  ["alert", "Alerte"],
  ["contacted", "Contactée"],
  ["applied", "Candidature"],
  ["interview", "Entretien"],
  ["won", "Gagnée"],
  ["lost", "Perdue"],
  ["dismissed", "Écartée"],
] as const;
export type ColumnKey = (typeof COLUMNS)[number][0];

/** The agent's four columns: it places a card there once; I may move any card anywhere. */
export const AGENT_COLUMN_KEYS: readonly string[] = ["detected", "direct", "profile", "alert"];

const REASONS: Readonly<Record<string, string>> = {
  esn_list: "ESN de la liste",
  esn_phrase: "intermédiaire dans le texte",
  esn_model: "ESN selon l'IA",
  intermediary_unknown: "intermédiaire incertain",
  stack: "stack",
  rate: "TJM",
  remote: "télétravail",
};

export function columnLabel(key: string): string {
  return COLUMNS.find(([k]) => k === key)?.[1] ?? "colonne inconnue";
}

/** Why a card stopped where it is; null when it reached the alert or I moved it. */
export function reasonLabel(reason: string | null): string | null {
  if (reason === null) return null;
  return REASONS[reason] ?? "raison inconnue";
}

export function deciderLabel(decidedBy: string, source: string): string {
  if (decidedBy === "me") return source === "me" ? "ajoutée par moi" : "déplacée par moi";
  return decidedBy === "model" ? "décidé par l'IA" : "décidé par une règle";
}

/** A mail's card was read by AI (AI Act, art. 50): said on the card itself. */
export function aiMark(source: string): string | null {
  return source === "mail" ? "extrait par IA" : null;
}

/** https only: anything else (javascript:, data:, http:) is shown as text, never a link. */
export function clickable(link: string | null): string | null {
  // Written exactly: lowercase scheme, two slashes, a host — never repaired by a parser.
  if (link === null || !/^https:\/\/[^\s"'<>/?#]+[^\s"'<>]*$/.test(link)) return null;
  try {
    return new URL(link).protocol === "https:" ? link : null;
  } catch {
    return null;
  }
}

export function rateLabel(rate: readonly [number, number] | null): string {
  if (rate === null) return "TJM non dit";
  return rate[0] === rate[1] ? `${rate[0]} €/j` : `${rate[0]}–${rate[1]} €/j`;
}

const REMOTE: Readonly<Record<string, string>> = {
  total: "télétravail total",
  partiel: "télétravail partiel",
  aucun: "sur site",
  inconnu: "télétravail non dit",
};

export function remoteLabel(remote: string): string {
  return REMOTE[remote] ?? "télétravail non dit";
}

/** Cards by column, in the board's order; a card in an unknown column is never lost. */
export function byColumn<T extends { readonly column: string }>(
  cards: readonly T[],
): { key: string; label: string; cards: T[] }[] {
  const known = new Set<string>(COLUMNS.map(([k]) => k));
  const out = COLUMNS.map(([key, label]) => ({
    key: key as string,
    label: label as string,
    cards: cards.filter((c) => c.column === key),
  }));
  const strays = cards.filter((c) => !known.has(c.column));
  if (strays.length > 0) out.push({ key: "inconnue", label: "Colonne inconnue", cards: strays });
  return out;
}
