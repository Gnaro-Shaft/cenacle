/**
 * One question, one short answer, from the local model (phase 4, B2).
 * Fresh context each time, no tool, temperature 0, few tokens: the model can
 * only answer with words, and only a few of them. Mail content never leaves
 * the machine (the router must agree).
 */
import { Agent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { ModelUnavailableError } from "./iris.ts";
import type { LocalModels } from "./local-model.ts";
import { route } from "./router.ts";

export interface OneShot {
  readonly system: string;
  readonly prompt: string;
  readonly maxTokens: number;
  readonly timeoutMs?: number;
}

export async function askLocalOnce(local: LocalModels, q: OneShot): Promise<string> {
  if (route({ dataClass: "mail_content" }, { euApiConfigured: false }) !== "local") {
    throw new Error("mail content may only reach the local model");
  }
  const agent = new Agent({
    initialState: {
      systemPrompt: q.system,
      model: { ...local.model, maxTokens: q.maxTokens },
      thinkingLevel: "off",
      tools: [],
    },
    streamFn: (model, context, options) =>
      local.models.streamSimple(model, context, { ...options, temperature: 0 }),
  });
  const timer = setTimeout(() => agent.abort(), q.timeoutMs ?? 60_000);
  try {
    await agent.prompt(q.prompt);
  } finally {
    clearTimeout(timer);
  }
  const last = agent.state.messages.at(-1);
  const answer = last?.role === "assistant" ? (last as AssistantMessage) : undefined;
  if (answer === undefined || answer.stopReason === "error" || answer.stopReason === "aborted") {
    const reason = answer?.stopReason === "aborted" ? "timeout" : "model_unavailable";
    throw new ModelUnavailableError(`The local model did not answer (${reason})`);
  }
  return answer.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
}

export function required(local: LocalModels | undefined): LocalModels {
  if (local === undefined) throw new Error("a local model is required");
  return local;
}
