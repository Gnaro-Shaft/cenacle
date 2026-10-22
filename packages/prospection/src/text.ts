/**
 * Short texts written by the model or typed by me (ADR-0032, point 7): an
 * offer's title, company or place. What has nothing to do there is removed —
 * a web address, an e-mail address, an @account, a phone number, a domain —
 * along with invisible and control characters. Never trusted, never HTML.
 */

/** Lowercase, without accents, punctuation as spaces: how lists are compared. */
export function normalized(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#]+/gu, " ")
    .trim();
}

/** Whole words: "esn" is in "une esn parisienne", not in "lesnes". */
export function hasWords(haystack: string, needle: string): boolean {
  return needle !== "" && ` ${haystack} `.includes(` ${needle} `);
}

const URL = /\b(?:https?:\/\/|www\.)\S*/gi;
const EMAIL = /\S+@\S+/g;
const HANDLE = /(^|[\s(])@[\p{L}\p{N}_.-]+/gu;
// A phone number: a leading 0 or an international prefix, then nine digits with
// the usual separators. Never a rate ("450-600") nor a period ("2026-2027").
const PHONE = /(?:\+\d{1,3}[\s.-]?|\b0)[1-9](?:[\s.-]?\d){8}\b/g;
// A word ending in a top-level domain, as a link preview would read it.
const DOMAIN =
  /\b[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:com|fr|io|net|org|dev|app|ai|co|eu|me|info|biz|xyz|tech|ly|gg|link|site|online|be|ch|ca|de|uk|us|example|test)\b/giu;
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** A short field, cleaned and capped at a word boundary; null when nothing is left. */
export function cleanField(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .normalize("NFC")
    .replace(INVISIBLE, " ")
    .replace(URL, " ")
    .replace(EMAIL, " ")
    .replace(HANDLE, "$1")
    .replace(PHONE, " ")
    .replace(DOMAIN, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned === "") return null;
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max + 1).replace(/\s+\S*$/, "");
  return cut === "" ? cleaned.slice(0, max) : cut;
}

/** A stack word: shorter, and kept as written ("Node.js" is a technology, not a domain). */
export function cleanStackWord(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const word = value.normalize("NFC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  if (word === "" || word.length > 30 || /@|https?:|www\./i.test(word)) return null;
  return /^[\p{L}\p{N} .+#/-]+$/u.test(word) ? word : null;
}
