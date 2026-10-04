/**
 * The M2 measures (phase 5), pure: no server, no base, no clock.
 *
 * - Sorting: my verdicts on Iris's categories, reduced to counts. Who wrote,
 *   and about what, is never part of the result.
 * - Leaks: is anything read from the real mails (subject, address, name,
 *   domain) found in what Cénacle keeps? A hit says which kind of value and
 *   where — never the value itself, so the report can be published.
 * - forTerminal: what is shown to me at the terminal cannot drive it (escape
 *   sequences, line breaks, direction overrides).
 */
import { CATEGORIES, type Category } from "@cenacle/core";

export type Decider = "rule" | "unreadable" | "model" | "set_aside";
const DECIDERS: readonly Decider[] = ["rule", "unreadable", "model", "set_aside"];

export interface Verdict {
  /** What Iris decided. */
  readonly iris: Category;
  /** What I say it is. */
  readonly truth: Category;
  readonly decidedBy: Decider;
}

export interface SortingMeasure {
  readonly total: number;
  readonly correct: number;
  /** Correct over all mails; null when there is none. */
  readonly accuracy: number | null;
  /** Correct among the mails Iris did not leave in "À trier". */
  readonly accuracyDecided: number | null;
  readonly aTrierShare: number | null;
  /** The serious mistake: a client or a prospect put in "bruit". */
  readonly clientsInBruit: number;
  readonly byDecider: Readonly<
    Record<Decider, { readonly total: number; readonly correct: number }>
  >;
  /** confusion[iris][truth]. */
  readonly confusion: Readonly<Record<Category, Readonly<Record<Category, number>>>>;
}

const ratio = (n: number, d: number) => (d === 0 ? null : n / d);
const isCategory = (v: unknown): v is Category => (CATEGORIES as readonly unknown[]).includes(v);

export function measureSorting(verdicts: readonly Verdict[]): SortingMeasure {
  const zeroRow = () =>
    Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  const confusion = Object.fromEntries(CATEGORIES.map((c) => [c, zeroRow()])) as Record<
    Category,
    Record<Category, number>
  >;
  const byDecider = Object.fromEntries(
    DECIDERS.map((d) => [d, { total: 0, correct: 0 }]),
  ) as Record<Decider, { total: number; correct: number }>;
  let correct = 0;
  let decided = 0;
  let decidedCorrect = 0;
  let clientsInBruit = 0;
  for (const v of verdicts) {
    if (!isCategory(v.iris) || !isCategory(v.truth) || !DECIDERS.includes(v.decidedBy)) {
      throw new Error("a verdict holds an unknown category or decider");
    }
    const ok = v.iris === v.truth;
    confusion[v.iris][v.truth] += 1;
    byDecider[v.decidedBy].total += 1;
    if (ok) {
      correct += 1;
      byDecider[v.decidedBy].correct += 1;
    }
    if (v.iris !== "a_trier") {
      decided += 1;
      if (ok) decidedCorrect += 1;
    }
    if (v.iris === "bruit" && v.truth === "clients_prospects") clientsInBruit += 1;
  }
  const total = verdicts.length;
  return {
    total,
    correct,
    accuracy: ratio(correct, total),
    accuracyDecided: ratio(decidedCorrect, decided),
    aTrierShare: ratio(total - decided, total),
    clientsInBruit,
    byDecider,
    confusion,
  };
}

export type NeedleKind = "objet" | "adresse" | "nom" | "domaine";

export interface Needle {
  readonly kind: NeedleKind;
  readonly value: string;
}

export interface Haystack {
  /** Where the text comes from (a table name): published as is. */
  readonly where: string;
  readonly text: string;
}

export interface Leak {
  readonly kind: NeedleKind;
  readonly where: string;
}

/** Shorter skeletons match by chance: not searched (and counted as such). */
export const MIN_NEEDLE = 8;

/**
 * Letters and digits only, lower case, compatibility-normalized, with JSON
 * \uXXXX escapes decoded: punctuation, spacing, quoting or escaping cannot hide a value.
 */
export function skeleton(text: string): string {
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Searchable needles: long enough, and not pure hexadecimal (that would match
 * the HMAC keys Cénacle keeps on purpose). Duplicates are searched once.
 */
export function searchable(needles: readonly Needle[]): { kept: Needle[]; tooShort: number } {
  const seen = new Set<string>();
  const kept: Needle[] = [];
  let tooShort = 0;
  for (const n of needles) {
    const s = skeleton(n.value);
    if (s.length < MIN_NEEDLE || /^[0-9a-f]+$/.test(s)) {
      if (s.length > 0) tooShort += 1;
      continue;
    }
    const key = `${n.kind}:${s}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ kind: n.kind, value: s });
  }
  return { kept, tooShort };
}

/** Every (kind, where) where a value read from the mails is found. Never the value. */
export function findLeaks(needles: readonly Needle[], haystacks: readonly Haystack[]): Leak[] {
  const { kept } = searchable(needles);
  const leaks = new Map<string, Leak>();
  for (const h of haystacks) {
    const text = skeleton(h.text);
    for (const n of kept) {
      if (text.includes(n.value))
        leaks.set(`${n.kind}\u0000${h.where}`, { kind: n.kind, where: h.where });
    }
  }
  return [...leaks.values()];
}

/**
 * Safe to print: no control character (ESC sequences, CR, NEL…), no bidi
 * override or isolate, bounded. A subject must not rewrite my terminal.
 */
export function forTerminal(text: string, max = 120): string {
  const clean = text
    .replace(/[\p{Cc}\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
