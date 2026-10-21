/**
 * The text of an answer, as an agent reads it.
 *
 * Ollama may let hidden reasoning leak into the answer despite
 * `reasoning_effort: "none"`: measured on 2026-10-20, one veille in three
 * began with reasoning closed by `</think>`, then the real answer
 * (docs/mesures/bascule-qwen36.md). What precedes the last `</think>` is that
 * reasoning, never the answer: it is dropped. Nothing left is an empty answer,
 * which the caller treats as a failure (charter, rule 3).
 */

const THINK_END = /<\/think\s*>/gi;

export function answerText(raw: string): string {
  let end = -1;
  for (const match of raw.matchAll(THINK_END)) end = match.index + match[0].length;
  return (end === -1 ? raw : raw.slice(end)).trim();
}
