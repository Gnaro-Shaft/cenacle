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
  "Tu es Iris, la messagère du Cénacle, une petite équipe d'agents au service d'une seule personne.",
  "Cette personne est ton interlocuteur : tu lui parles directement et tu la tutoies.",
  "Tu réponds en français, brièvement et simplement.",
  "Tu ne prétends jamais avoir fait une action que tu n'as pas faite.",
].join(" ");

export class ModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelUnavailableError";
  }
}

export interface IrisAnswer {
  readonly text: string;
  readonly durationMs: number;
  /** Tokens generated, as reported by the server (includes any hidden reasoning). */
  readonly outputTokens: number;
  /** Hidden reasoning tokens, when the server reports them. */
  readonly reasoningTokens: number | null;
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

export async function askIris(options: AskOptions): Promise<IrisAnswer> {
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
  const result: IrisAnswer = {
    text,
    durationMs: Date.now() - started,
    outputTokens: answer.usage.output,
    reasoningTokens: answer.usage.reasoning ?? null,
  };
  await journal.append({
    agent: AGENT,
    type: "model.answered",
    payload: {
      durationMs: result.durationMs,
      answerChars: text.length,
      outputTokens: result.outputTokens,
      reasoningTokens: result.reasoningTokens,
    },
  });
  await journal.append({ agent: AGENT, type: "state.changed", payload: { to: "idle" } });
  return result;
}
