/**
 * Iris asks the local model a question (milestone J7: first breath of Pi).
 *
 * Every step is journaled — routing, thinking, answered or failed — but never
 * the question or the answer themselves: the journal keeps facts, not content.
 */

import type { Journal } from "@cenacle/journal";
import { Agent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { LocalModels } from "./local-model.ts";
import { type DataClass, route } from "./router.ts";

export const IRIS_SYSTEM_PROMPT = [
  "Tu es Iris, messagère du Cénacle, l'équipe d'agents de ton propriétaire.",
  "Tu réponds en français, brièvement et simplement.",
  "Tu ne prétends jamais avoir fait une action que tu n'as pas faite.",
].join(" ");

export class ModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelUnavailableError";
  }
}

export interface AskOptions {
  readonly question: string;
  readonly dataClass: DataClass;
  readonly journal: Journal;
  readonly local: LocalModels;
  readonly timeoutMs?: number;
}

const AGENT = "iris";

function textOf(message: AssistantMessage): string {
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();
}

export async function askIris(options: AskOptions): Promise<string> {
  const { journal, local } = options;
  // Phase 1 has no EU API: the router must answer "local" for every class.
  const destination = route({ dataClass: options.dataClass }, { euApiConfigured: false });
  await journal.append({
    agent: AGENT,
    type: "model.routed",
    payload: { dataClass: options.dataClass, destination, model: local.model.id },
  });
  await journal.append({ agent: AGENT, type: "state.changed", payload: { to: "thinking" } });

  const started = Date.now();
  const agent = new Agent({
    initialState: { systemPrompt: IRIS_SYSTEM_PROMPT, model: local.model, thinkingLevel: "off" },
    streamFn: local.models.streamSimple.bind(local.models),
  });
  const timer = setTimeout(() => agent.abort(), options.timeoutMs ?? 120_000);
  try {
    await agent.prompt(options.question);
  } finally {
    clearTimeout(timer);
  }

  const last = agent.state.messages.at(-1);
  const answer = last?.role === "assistant" ? (last as AssistantMessage) : undefined;
  if (answer === undefined || answer.stopReason === "error" || answer.stopReason === "aborted") {
    const reason = answer?.stopReason === "aborted" ? "timeout" : "model_unavailable";
    await journal.append({
      agent: AGENT,
      type: "state.changed",
      payload: { to: "error", reason },
    });
    throw new ModelUnavailableError(
      `The local model did not answer (${reason}): ${answer?.errorMessage ?? "no message"}`,
    );
  }

  const text = textOf(answer);
  await journal.append({
    agent: AGENT,
    type: "model.answered",
    payload: { durationMs: Date.now() - started, answerChars: text.length },
  });
  await journal.append({ agent: AGENT, type: "state.changed", payload: { to: "idle" } });
  return text;
}
