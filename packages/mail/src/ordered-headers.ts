/**
 * A raw header block as an ordered list of fields, duplicates kept.
 *
 * splitHeaders (postman.ts) turns a repeated header into null: right for From,
 * wrong for Received and Authentication-Results, which every server on the way
 * adds on top. Their order is the evidence: what our own server added sits
 * above what the sender wrote.
 */

export interface HeaderField {
  /** Lowercased. */
  readonly name: string;
  /** Unfolded, trimmed. Never cut: a reader that needs a bound checks it. */
  readonly value: string;
}

/** Only the first fields of a block are read; `truncated` says when more were there. */
export const MAX_FIELDS = 200;
const NAME = /^[!-9;-~]+$/; // printable ASCII but ":" (RFC 5322 field name)

export interface OrderedHeaders {
  readonly fields: readonly HeaderField[];
  readonly truncated: boolean;
}

export function orderedHeaders(raw: string): OrderedHeaders {
  const fields: { name: string; value: string }[] = [];
  let truncated = false;
  for (const line of raw.split(/\r?\n/)) {
    if (/^[ \t]/.test(line)) {
      const last = fields.at(-1);
      // A continuation before any field belongs to nothing: dropped.
      if (last !== undefined && !truncated) last.value = `${last.value} ${line.trim()}`.trim();
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).toLowerCase();
    if (!NAME.test(name)) continue;
    if (fields.length >= MAX_FIELDS) {
      truncated = true;
      break;
    }
    fields.push({ name, value: line.slice(colon + 1).trim() });
  }
  return { fields, truncated };
}
