/**
 * The text of an answer, as an agent reads it.
 *
 * Ollama may let hidden reasoning leak into the answer despite
 * `reasoning_effort: "none"`: measured on 2026-10-20, a veille answered a
 * JSON array, then `</think>`, then the real array
 * (docs/mesures/bascule-qwen36.md). What precedes the last such tag is that
 * reasoning, never the answer: it is dropped. Nothing left is an empty answer,
 * which the caller treats as a failure (charter, rule 3).
 *
 * A tag the answer *cites* is no leak: in a code block, in inline code, or
 * between quotes. On 2026-10-21 the CTO, asked about this very change, wrote
 * "`</think>`" in his answer, and 2 characters of 420 tokens were left.
 */

const THINK_END = /<\/think\s*>/gi;
const QUOTE_BEFORE = /[`'"«“][   ]?$/;
const QUOTE_AFTER = /^[   ]?[`'"»”]/;
const INDENT = /[ \t]/;

export function answerText(raw: string): string {
  let end = -1;
  // One pass over the text, up to each tag: inside a fenced block? how many
  // backticks so far on the line (odd: inside inline code)?
  let pos = 0;
  let inFence = false;
  let ticks = 0;
  let atLineStart = true;
  for (const match of raw.matchAll(THINK_END)) {
    for (; pos < match.index; pos++) {
      const c = raw[pos] as string;
      if (c === "\n") {
        atLineStart = true;
        ticks = 0;
        continue;
      }
      if (atLineStart && INDENT.test(c)) continue;
      if (atLineStart) {
        atLineStart = false;
        if (raw.startsWith("```", pos)) {
          inFence = !inFence;
          pos += 2;
          continue;
        }
      }
      if (c === "`") ticks++;
    }
    const after = match.index + match[0].length;
    const quoted =
      QUOTE_BEFORE.test(raw.slice(Math.max(0, match.index - 2), match.index)) ||
      QUOTE_AFTER.test(raw.slice(after, after + 2));
    if (!inFence && ticks % 2 === 0 && !quoted) end = after;
  }
  return (end === -1 ? raw : raw.slice(end)).trim();
}
