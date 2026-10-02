/**
 * Iris asks the local model a question (milestone J7: first breath of Pi).
 *
 * Every step is journaled — routing, thinking, answered or failed — but never
 * the question or the answer themselves: the journal keeps facts, not content.
 */

import type { Journal } from "@cenacle/journal";
import { Agent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";
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
const tracer = trace.getTracer("cenacle.brain");

/**
 * The only attributes a span may carry: structure and counts, never content.
 * Tests check every recorded attribute against this list.
 */
export const SPAN_ATTRIBUTES = [
  "cenacle.agent",
  "cenacle.data_class",
  "cenacle.destination",
  "cenacle.outcome",
  "gen_ai.request.model",
  "gen_ai.usage.output_tokens",
  "gen_ai.usage.reasoning_tokens",
] as const;

function textOf(message: AssistantMessage): string {
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();
}

export function askIris(options: AskOptions): Promise<IrisAnswer> {
  return tracer.startActiveSpan("iris.ask", async (span) => {
    try {
      return await askIrisTraced(options, span);
    } catch (error) {
      span.setAttribute(
        "cenacle.outcome",
        error instanceof ModelUnavailableError ? "model_unavailable" : "error",
      );
      // The message may quote the model server; only the error's name is recorded.
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).name });
      throw error;
    } finally {
      span.end();
    }
  });
}

async function askIrisTraced(options: AskOptions, span: Span): Promise<IrisAnswer> {
  const { journal, local } = options;
  // Phase 1 has no EU API: the router must answer "local" for every class.
  const destination = route({ dataClass: options.dataClass }, { euApiConfigured: false });
  span.setAttributes({
    "cenacle.agent": AGENT,
    "cenacle.data_class": options.dataClass,
    "cenacle.destination": destination,
    "gen_ai.request.model": local.model.id,
  });
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
  span.setAttributes({
    "cenacle.outcome": "answered",
    "gen_ai.usage.output_tokens": answer.usage.output,
    ...(answer.usage.reasoning === undefined
      ? {}
      : { "gen_ai.usage.reasoning_tokens": answer.usage.reasoning }),
  });
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
