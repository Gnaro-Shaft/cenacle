/**
 * The fact checker for drafts (phase 4, B0) — no model involved.
 *
 * A draft may only state facts that exist in the conversation it answers:
 * every number, amount, time, date, weekday, e-mail address, link and phone
 * number it contains must also be found there. Anything else is "unsupported"
 * and shown in red before I validate. This is what makes "0 invented fact"
 * measurable. Its limit, by design: it checks facts, not meaning — a vague
 * promise without a number ("je m'en occupe") is for me to judge.
 */

export type FactKind = "number" | "time" | "date" | "weekday" | "email" | "url" | "phone";

export interface Fact {
  readonly kind: FactKind;
  /** Normalized value, comparable between draft and sources. */
  readonly value: string;
  /** As written in the text, for display. */
  readonly raw: string;
}

const MONTHS: Readonly<Record<string, number>> = {
  janvier: 1,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
};
const WEEKDAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  onze: 11,
  douze: 12,
  treize: 13,
  quatorze: 14,
  quinze: 15,
  seize: 16,
  vingt: 20,
  trente: 30,
  quarante: 40,
  cinquante: 50,
  soixante: 60,
  cent: 100,
  mille: 1000,
};

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** "3 000", "3 000" or "3.000" → "3000"; "2,5" → "2.5". */
function normalizeNumber(raw: string): string {
  const compact = raw.replace(/[\s  ]/g, "");
  const thousands = /^\d{1,3}([.]\d{3})+$/.test(compact) ? compact.replace(/\./g, "") : compact;
  const n = Number(thousands.replace(",", "."));
  return Number.isFinite(n) ? String(n) : thousands;
}

export function extractFacts(text: string): Fact[] {
  const facts: Fact[] = [];
  const seen = new Set<string>();
  const add = (kind: FactKind, value: string, raw: string) => {
    const k = `${kind}:${value}`;
    if (!seen.has(k)) {
      seen.add(k);
      facts.push({ kind, value, raw: raw.trim() });
    }
  };
  let rest = text;
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    for (const m of rest.matchAll(re)) fn(m);
    rest = rest.replace(re, " ");
  };

  take(/https?:\/\/[^\s<>"')]+/gi, (m) =>
    add("url", m[0].toLowerCase().replace(/[.,;]+$/, ""), m[0]),
  );
  take(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) =>
    add("email", m[0].toLowerCase(), m[0]),
  );
  take(/(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}/g, (m) =>
    add("phone", m[0].replace(/\D/g, "").replace(/^33/, "0"), m[0]),
  );
  take(/\b(\d{1,2})\s?[hH](?:\s?(\d{2}))?\b/g, (m) =>
    add("time", `${Number(m[1])}:${m[2] ?? "00"}`, m[0]),
  );
  take(/\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/g, (m) =>
    add("date", `${Number(m[1])}-${Number(m[2])}`, m[0]),
  );
  // "15 décembre", "1er octobre"
  const folded = fold(rest);
  for (const m of folded.matchAll(
    /\b(\d{1,2})(?:er)?\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b/g,
  )) {
    add("date", `${Number(m[1])}-${MONTHS[m[2] ?? ""]}`, m[0]);
  }
  rest = fold(rest).replace(
    /\b\d{1,2}(?:er)?\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b/g,
    " ",
  );
  for (const day of WEEKDAYS) if (new RegExp(`\\b${day}\\b`).test(rest)) add("weekday", day, day);
  for (const m of rest.matchAll(/\d+(?:[\s  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g)) {
    add("number", normalizeNumber(m[0]), m[0]);
  }
  for (const m of rest.matchAll(/\b[a-z]+\b/g)) {
    const n = NUMBER_WORDS[m[0]];
    // "un"/"une" are articles far more often than numbers: not counted.
    if (n !== undefined && n > 1) add("number", String(n), m[0]);
  }
  return facts;
}

export interface FactCheck {
  readonly unsupported: readonly Fact[];
  readonly ok: boolean;
}

/** `sources`: the conversation (and the fixed signature / template text). */
export function checkDraft(draft: string, sources: readonly string[]): FactCheck {
  const known = new Set(sources.flatMap((s) => extractFacts(s).map((f) => `${f.kind}:${f.value}`)));
  const unsupported = extractFacts(draft).filter((f) => !known.has(`${f.kind}:${f.value}`));
  return { unsupported, ok: unsupported.length === 0 };
}
