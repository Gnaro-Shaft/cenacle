/**
 * The entries of the model's answer, as many as can be read (lot C, 13/11).
 * The answer is a JSON array of small objects. On 34 veilles, 14 first
 * answers failed as a whole: cut at the model's 8 000-token bound, or one
 * entry malformed — and one bad entry threw away the 29 good ones. Now the
 * array is read whole when it can be; otherwise each `{…}` at the array's
 * top level is read on its own, and an entry that does not parse, or that
 * the cut left open, is counted as unreadable.
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

/** Null when the answer holds no array at all. */
export function readEntries(answer: string): Entries | null {
  const start = answer.indexOf("[");
  if (start < 0) return null;
  const end = answer.lastIndexOf("]");
  if (end > start) {
    try {
      const whole: unknown = JSON.parse(answer.slice(start, end + 1));
      if (Array.isArray(whole)) return { entries: whole, unreadable: 0, oneByOne: false };
    } catch {
      // Read one by one below.
    }
  }
  // One by one from the array of objects: `[{`, not a `[` in the prose before it.
  const objects = answer.search(/\[\s*\{/);
  if (objects < 0) return { entries: [], unreadable: 0, oneByOne: true };
  const { closed, open } = objectTexts(answer.slice(objects + 1));
  const entries: unknown[] = [];
  let unreadable = open ? 1 : 0;
  for (const text of closed) {
    try {
      entries.push(JSON.parse(text));
    } catch {
      unreadable++;
    }
  }
  return { entries, unreadable, oneByOne: true };
}
