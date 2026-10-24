/**
 * Which documents a question is about (ADR-0033, § 2): a lexical score, by
 * code, the same at every call. No model, no stored index: computed on the
 * admitted documentation each time.
 *
 * Words: lower case, accents folded, stop words dropped, three letters at
 * least, a plural's final s or x dropped. The score is BM25: a word rare in
 * the documentation counts more; length alone favours no document; a word in
 * the title counts more than in the body. An ADR number or a path named in
 * the question comes first, whatever its score.
 */
import type { ContextFile } from "./context.ts";

const K1 = 1.2;
const B = 0.75;
/** A title word counts as this many body words. */
const TITLE_WEIGHT = 3;

const STOP_WORDS = new Set(
  // French, accents folded
  (
    "les des une est que qui quoi dans pour par sur avec sans sous entre vers chez " +
    "son ses leur leurs mon mes ton tes notre nos votre vos elle elles ils nous vous " +
    "lui eux moi toi cela ceci cette ces cet celui celle ceux celles quel quelle quels " +
    "quelles lequel laquelle lesquels dont comment pourquoi quand combien ont pas plus " +
    "moins tres trop tout tous toute toutes aussi alors donc mais car comme etre avoir " +
    "fait faire sont etait sera peut peuvent doit doivent faut ete jamais rien chaque " +
    "autre autres meme encore deja ainsi apres avant depuis pendant selon partir moment " +
    "dit dire " +
    // Every ADR's title holds it: a named ADR is found by its number instead.
    "adr " +
    // English
    "the and for are but not you all any can her was one our out has have had his how " +
    "its may new now old see two way who did get let put say she too use what when " +
    "where which while with from this that these those than then them they there into " +
    "will would should could about after before does done each more most much only other " +
    "over same some such very why"
  ).split(" "),
);

const fold = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The words of a text, as the score counts them. */
export function words(text: string): string[] {
  const out: string[] = [];
  for (const raw of fold(text).split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || !/[a-z]/.test(raw) || STOP_WORDS.has(raw)) continue;
    out.push(raw.length > 4 && /[sx]$/.test(raw) ? raw.slice(0, -1) : raw);
  }
  return out;
}

/** The first `# ` line of a document, or its path. */
export function titleOf(file: ContextFile): string {
  const line = /^#\s+(.+)$/m.exec(file.text)?.[1]?.trim();
  return line === undefined || line === "" ? file.path : line;
}

const ADR_NUMBER = /docs\/adr\/(\d{4})-/;

/**
 * Documents the question names: an ADR by number ("ADR-0025", "ADR 25",
 * "0025") or a document by its path. In the order they are named.
 */
export function namedIn(question: string, files: readonly ContextFile[]): string[] {
  const named: { at: number; path: string }[] = [];
  const byNumber = new Map<number, string>();
  for (const f of files) {
    const at = question.indexOf(f.path);
    if (at !== -1) named.push({ at, path: f.path });
    const n = ADR_NUMBER.exec(f.path)?.[1];
    if (n !== undefined) byNumber.set(Number(n), f.path);
  }
  for (const m of question.matchAll(/\bADR[-\s]?(\d{1,4})\b|\b(\d{4})\b/gi)) {
    const path = byNumber.get(Number(m[1] ?? m[2]));
    if (path !== undefined) named.push({ at: m.index, path });
  }
  named.sort((a, b) => a.at - b.at);
  return [...new Set(named.map((n) => n.path))];
}

/**
 * The documents a question is about, most relevant first: named ones, then
 * every document with a score above zero; ties keep the order given. A
 * question without a useful word and naming nothing gets an empty list.
 */
export function rankByRelevance(question: string, files: readonly ContextFile[]): string[] {
  const named = namedIn(question, files);
  const asked = [...new Set(words(question))];
  if (asked.length === 0) return named;
  const docs = files.map((f) => {
    const tf = new Map<string, number>();
    const body = words(f.text);
    for (const w of body) tf.set(w, (tf.get(w) ?? 0) + 1);
    for (const w of words(titleOf(f))) tf.set(w, (tf.get(w) ?? 0) + TITLE_WEIGHT);
    return { path: f.path, tf, length: body.length };
  });
  const n = docs.length;
  const average = docs.reduce((sum, d) => sum + d.length, 0) / Math.max(n, 1) || 1;
  const idf = new Map(
    asked.map((w) => {
      const holding = docs.filter((d) => d.tf.has(w)).length;
      return [w, Math.log(1 + (n - holding + 0.5) / (holding + 0.5))];
    }),
  );
  const scored = docs
    .map((d, order) => {
      let score = 0;
      for (const w of asked) {
        const f = d.tf.get(w) ?? 0;
        if (f === 0) continue;
        score +=
          (idf.get(w) ?? 0) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.length) / average)));
      }
      return { path: d.path, score, order };
    })
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order);
  return [...new Set([...named, ...scored.map((d) => d.path)])];
}
