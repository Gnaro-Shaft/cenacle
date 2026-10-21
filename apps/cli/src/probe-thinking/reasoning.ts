/**
 * The probe's "reasoning" column (npm run probe:thinking). Servers disagree on
 * where the hidden reasoning goes: LM Studio and vLLM answer
 * `message.reasoning_content`, Ollama `message.reasoning`; some count its
 * tokens in `usage.completion_tokens_details`, Ollama does not.
 */

export interface Completion {
  choices?: {
    message?: { content?: string; reasoning_content?: unknown; reasoning?: unknown };
  }[];
  usage?: {
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

/**
 * The reasoning tokens the server counted, else the length of the reasoning it
 * sent, else 0. "?" when the reply holds no message (a server error): an error
 * is not "no reasoning".
 */
export function reasoningShown(data: Completion | null): number | string {
  const message = data?.choices?.[0]?.message;
  if (typeof message !== "object" || message === null) return "?";
  const tokens = data?.usage?.completion_tokens_details?.reasoning_tokens;
  if (typeof tokens === "number" && tokens > 0) return tokens;
  // A count of 0 next to a reasoning text is not believed: the text is shown.
  const text = [message.reasoning_content, message.reasoning].find(
    (t): t is string => typeof t === "string" && t.trim() !== "",
  );
  return text === undefined ? 0 : `~${text.length} chars`;
}
