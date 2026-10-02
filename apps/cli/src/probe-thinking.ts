/**
 * Measures which "no thinking" switch the local model server honours.
 * Sends the same short question with each variant and reports time and tokens.
 * Usage: npm run probe:thinking [repetitions, default 3]
 * Nothing is journaled: this is a diagnostic tool, not Iris.
 */
import { localModelConfigFromEnv } from "@cenacle/brain";

const { baseUrl, modelId } = localModelConfigFromEnv();
const QUESTION = "Présente-toi en une phrase.";

const VARIANTS: Record<string, Record<string, unknown>> = {
  "default (nothing sent)": {},
  "chat_template_kwargs.enable_thinking=false": {
    chat_template_kwargs: { enable_thinking: false },
  },
  "enable_thinking=false (top level)": { enable_thinking: false },
  "/no_think in the system prompt": { __systemSuffix: " /no_think" },
  'reasoning_effort="none" (what Iris now sends)': { reasoning_effort: "none" },
};

interface Completion {
  choices?: { message?: { content?: string; reasoning_content?: string } }[];
  usage?: {
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

const REPEAT = Number(process.argv[2] ?? 3);

for (const [label, extra] of Object.entries(VARIANTS)) {
  for (let run = 1; run <= REPEAT; run++) {
    const { __systemSuffix, ...fields } = extra as { __systemSuffix?: string };
    const started = Date.now();
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 2048,
        messages: [
          { role: "system", content: `Tu es Iris. Réponds brièvement.${__systemSuffix ?? ""}` },
          { role: "user", content: QUESTION },
        ],
        ...fields,
      }),
    });
    const data = (await response.json()) as Completion;
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const message = data.choices?.[0]?.message;
    const reasoning =
      data.usage?.completion_tokens_details?.reasoning_tokens ??
      (message?.reasoning_content ? `~${message.reasoning_content.length} chars` : 0);
    console.log(
      `${label.padEnd(46)} #${run} ${seconds.padStart(5)} s  ${String(data.usage?.completion_tokens ?? "?").padStart(4)} tokens  reasoning: ${reasoning}`,
    );
  }
}
