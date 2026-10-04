/**
 * The processing register as the code reads it (ADR-0009, phase 5, C1).
 *
 * - `[conservation]`: how long each store keeps what it keeps. The purges
 *   read these values; nothing is hard-coded elsewhere.
 * - `[[traitement]]`: the OPEN processings only. A real mail source that no
 *   open processing covers is not read; a processing without the date its
 *   notice was published refuses to start (informing people is what makes it
 *   lawful); a source claimed twice is refused (two retentions make no sense).
 * The written register (docs/conformite/registre-traitements.md) holds what
 * does not code: the balance of interests, the measures, the limits.
 */

export interface Conservation {
  /** What Iris remembers of a mail (keys, dates, category), after its arrival. */
  readonly memoireJours: number;
  /** The text of a proposal, after it is closed. */
  readonly texteBrouillonJours: number;
  /** A closed proposal's row, after it is closed. */
  readonly propositionsJours: number;
  /** Journal events. Longer than the mail memory: an open proposal keeps its events. */
  readonly journalJours: number;
}

export const LEGAL_BASES = [
  "interet-legitime",
  "contrat",
  "obligation-legale",
  "consentement",
] as const;
export type LegalBasis = (typeof LEGAL_BASES)[number];

export interface Traitement {
  readonly identifiant: string;
  readonly finalite: string;
  readonly baseLegale: LegalBasis;
  readonly categories: readonly string[];
  readonly sources: readonly string[];
  /** Whether third parties' data is processed (correspondents). */
  readonly tiers: boolean;
  /** When the information notice was published: before it, nothing is read. */
  readonly mentionPubliee: string;
}

export class TraitementError extends Error {
  constructor(message: string) {
    super(`cadre.toml: ${message}`);
    this.name = "TraitementError";
  }
}

const isTable = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function onlyKeys(table: Record<string, unknown>, allowed: readonly string[], where: string) {
  for (const key of Object.keys(table)) {
    if (!allowed.includes(key)) throw new TraitementError(`unknown key "${key}" in ${where}`);
  }
}

function days(table: Record<string, unknown>, key: string, min: number, max: number): number {
  const v = table[key];
  const n = typeof v === "bigint" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new TraitementError(`conservation.${key} must be a number of days from ${min} to ${max}`);
  }
  return n;
}

export function parseConservation(raw: unknown): Conservation {
  if (!isTable(raw)) throw new TraitementError("missing [conservation] section");
  const keys = ["memoire_jours", "texte_brouillon_jours", "propositions_jours", "journal_jours"];
  onlyKeys(raw, keys, "[conservation]");
  const c = {
    memoireJours: days(raw, "memoire_jours", 1, 365),
    texteBrouillonJours: days(raw, "texte_brouillon_jours", 1, 30),
    propositionsJours: days(raw, "propositions_jours", 1, 365),
    journalJours: days(raw, "journal_jours", 1, 730),
  };
  // A proposal stays open at most as long as its mail is remembered (then it
  // lapses): the journal must outlive it, or the bubble on the page goes wrong.
  if (c.journalJours <= c.memoireJours) {
    throw new TraitementError("conservation.journal_jours must exceed memoire_jours");
  }
  return c;
}

const ID = /^T-\d{2}$/;
const SOURCE = /^[a-z][a-z0-9-]{1,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(t: Record<string, unknown>, key: string, where: string, max: number): string {
  const v = t[key];
  if (typeof v !== "string" || v.trim().length === 0 || v.length > max) {
    throw new TraitementError(
      `${where}.${key} must be a non-empty text (${max} characters at most)`,
    );
  }
  return v.trim();
}

function list(t: Record<string, unknown>, key: string, where: string, rule?: RegExp): string[] {
  const v = t[key];
  if (!Array.isArray(v) || v.length === 0) {
    throw new TraitementError(`${where}.${key} must be a non-empty list`);
  }
  return v.map((item) => {
    if (
      typeof item !== "string" ||
      item.trim() === "" ||
      (rule !== undefined && !rule.test(item))
    ) {
      throw new TraitementError(`${where}.${key}: invalid entry ${JSON.stringify(item)}`);
    }
    return item;
  });
}

/** A TOML local date (1979-05-27) or a quoted one; nothing else. */
function publishedOn(v: unknown, where: string, today: string): string {
  // smol-toml gives a Date for a TOML date; its ISO form starts with the day.
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "string" ? v : "";
  if (!DATE.test(s) || Number.isNaN(Date.parse(s))) {
    throw new TraitementError(
      `${where}.mention_publiee is required: the date the notice was published (nothing is read before)`,
    );
  }
  if (s > today) throw new TraitementError(`${where}.mention_publiee ${s} is not reached yet`);
  return s;
}

const TRAITEMENT_KEYS = [
  "identifiant",
  "finalite",
  "base_legale",
  "categories",
  "sources",
  "tiers",
  "mention_publiee",
];

/** `today` is the local date (YYYY-MM-DD): a notice dated later is not published yet. */
export function parseTraitements(raw: unknown, today: string): Traitement[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new TraitementError("[[traitement]] must be a list of tables");
  const seen = new Set<string>();
  const claimed = new Map<string, string>();
  return raw.map((t, i) => {
    const where = `traitement[${i}]`;
    if (!isTable(t)) throw new TraitementError(`${where} must be a table`);
    onlyKeys(t, TRAITEMENT_KEYS, where);
    const identifiant = text(t, "identifiant", where, 8);
    if (!ID.test(identifiant)) {
      throw new TraitementError(`${where}.identifiant must look like T-01`);
    }
    if (seen.has(identifiant)) throw new TraitementError(`${identifiant} is declared twice`);
    seen.add(identifiant);
    const base = t.base_legale;
    if (typeof base !== "string" || !(LEGAL_BASES as readonly string[]).includes(base)) {
      throw new TraitementError(
        `${identifiant}.base_legale must be one of ${LEGAL_BASES.join(", ")}`,
      );
    }
    if (typeof t.tiers !== "boolean") {
      throw new TraitementError(`${identifiant}.tiers must be true or false`);
    }
    const sources = list(t, "sources", identifiant, SOURCE);
    for (const s of sources) {
      const owner = claimed.get(s);
      if (owner !== undefined) {
        throw new TraitementError(`source "${s}" is claimed by ${owner} and ${identifiant}`);
      }
      claimed.set(s, identifiant);
    }
    return {
      identifiant,
      finalite: text(t, "finalite", identifiant, 500),
      baseLegale: base as LegalBasis,
      categories: list(t, "categories", identifiant),
      sources,
      tiers: t.tiers,
      mentionPubliee: publishedOn(t.mention_publiee, identifiant, today),
    };
  });
}

/** The open processing covering a source, if any. */
export const coveringTraitement = (
  source: string,
  traitements: readonly Traitement[],
): Traitement | undefined => traitements.find((t) => t.sources.includes(source));
