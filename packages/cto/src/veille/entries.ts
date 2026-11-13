/**
 * The entries of the model's answer, as many as can be read (lot C, 13/11).
 * The answer is a JSON array of small objects. On 34 veilles, 14 first
 * answers failed as a whole: cut at the model's 8 000-token bound, or one
 * entry malformed — and one bad entry threw away the 29 good ones. Now the
 * array is read whole when it can be; otherwise its entries are read one by
 * one, in order (i = 1, 2, 3…), up to the first that does not parse, breaks
 * the order, or was left open by the cut: those are counted as unreadable.
 */

export interface Entries {
  readonly entries: readonly unknown[];
  /** Entries seen but not readable (malformed, or left open by a cut). */
  readonly unreadable: number;
  /** True when the array could not be read whole: entries were read one by one. */
  readonly oneByOne: boolean;
}

/** The text of each top-level `{…}` after `[`, strings and escapes respected; an open one last. */
function objectTexts(text: string): { closed: string[]; open: boolean } {
  const closed: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = depth > 0;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0) closed.push(text.slice(start, i + 1));
    } else if (ch === "]" && depth === 0) break;
  }
  return { closed, open: depth > 0 };
}

/** The array starting at `at` read whole (to the last `]`), or null. */
function whole(answer: string, at: number): Entries | null {
  const end = answer.lastIndexOf("]");
  if (end <= at) return null;
  try {
    const value: unknown = JSON.parse(answer.slice(at, end + 1));
    return Array.isArray(value) ? { entries: value, unreadable: 0, oneByOne: false } : null;
  } catch {
    return null;
  }
}

/**
 * Null when the answer holds no array at all. Each array of objects (`[{`)
 * is tried — prose may show an example first — whole, else one by one; the
 * one giving the most entries wins, a whole one on a tie.
 */
export function readEntries(answer: string): Entries | null {
  const first = answer.indexOf("[");
  if (first < 0) return null;
  let best: Entries | null = null;
  for (const match of answer.matchAll(/\[\s*\{/g)) {
    const read = whole(answer, match.index) ?? leadingRun(answer.slice(match.index + 1));
    if (best === null || read.entries.length > best.entries.length) best = read;
  }
  return best ?? whole(answer, first) ?? { entries: [], unreadable: 0, oneByOne: true };
}

/**
 * The entries read one by one, kept only while they follow 1, 2, 3… and
 * stopping at the first unreadable one (C3 review). An entry the model left
 * malformed — a quote of an article not escaped — is where an article's own
 * text could pass for entries: past it, nothing is trusted. A forged entry
 * before it must also carry the very next number, so it can take at most one
 * article's score, never add one.
 */
function leadingRun(text: string): Entries {
  const { closed, open } = objectTexts(text);
  const entries: unknown[] = [];
  for (const [k, part] of closed.entries()) {
    let entry: unknown;
    try {
      entry = JSON.parse(part);
    } catch {
      return { entries, unreadable: closed.length - k + (open ? 1 : 0), oneByOne: true };
    }
    const i = (entry as { i?: unknown } | null)?.i;
    if (i !== entries.length + 1) {
      return { entries, unreadable: closed.length - k + (open ? 1 : 0), oneByOne: true };
    }
    entries.push(entry);
  }
  return { entries, unreadable: open ? 1 : 0, oneByOne: true };
}
