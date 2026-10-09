/**
 * One question, one checked answer (ADR-0017, ADR-0020): the documentation
 * chosen by code, the local model, every reference checked in the repository,
 * one rewrite if anything is missing. Shared by the CTO's service and by
 * `npm run cto` when the service is not running. Nothing is kept: the journal
 * gets counts under the agent "cto".
 */
import {
  askAgent,
  createLocalModels,
  type LocalModels,
  localModelConfigFromEnv,
} from "@cenacle/brain";
import type { Journal } from "@cenacle/journal";
import { answerVerified, checkSummary } from "./answer.ts";
import { loadProjectContext } from "./context.ts";
import { ctoSystemPrompt } from "./prompt.ts";
import { buildRepoIndex } from "./verify.ts";

/** A question is short text: no control character but line breaks and tabs. */
export const MAX_QUESTION = 2000;
/** A control character, line feed and tab excepted. */
const hasControl = (text: string): boolean =>
  [...text].some((ch) => {
    const code = ch.charCodeAt(0);
    return (code < 0x20 && ch !== "\n" && ch !== "\t") || code === 0x7f;
  });

export class QuestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionError";
  }
}

export function validQuestion(question: unknown): string {
  if (typeof question !== "string") throw new QuestionError("la question doit être un texte");
  const text = question.trim();
  if (text === "") throw new QuestionError("la question est vide");
  if (text.length > MAX_QUESTION) {
    throw new QuestionError(`la question dépasse ${MAX_QUESTION} caractères`);
  }
  if (hasControl(text)) throw new QuestionError("la question contient des caractères de contrôle");
  return text;
}

export type CtoProgress =
  | { readonly kind: "queued"; readonly ahead: number }
  | { readonly kind: "reading"; readonly phase: "premier jet" | "correction" }
  | {
      readonly kind: "writing";
      readonly phase: "premier jet" | "correction";
      readonly chars: number;
    }
  | { readonly kind: "revising"; readonly missing: number };

export interface CtoReply {
  readonly text: string;
  /** The check, shown under the answer. */
  readonly summary: string;
  readonly cut: boolean;
  readonly revised: boolean;
  readonly seconds: number;
  readonly documents: number;
}

export interface CtoDeps {
  readonly root: string;
  readonly journal: Journal;
  readonly local: LocalModels;
  readonly onProgress?: (progress: CtoProgress) => void;
}

/**
 * Up to 200 k characters of documentation, ~60 k tokens: a window far above
 * Iris's, within what LM Studio loads for the shared model. Answers are short
 * (the model writes ~18 tokens/s): 1500 tokens, ~1000 words at most.
 */
export function ctoModels(): LocalModels {
  return createLocalModels({
    ...localModelConfigFromEnv(),
    contextWindow: 131_072,
    maxTokens: 1500,
  });
}

export async function askCto(question: string, deps: CtoDeps): Promise<CtoReply> {
  const text = validQuestion(question);
  const started = Date.now();
  const context = loadProjectContext(deps.root);
  const system = ctoSystemPrompt("Cénacle", context);
  const tell = (progress: CtoProgress) => {
    try {
      deps.onProgress?.(progress);
    } catch {
      // Progress is display only: a failing display never costs the answer.
    }
  };
  let phase: "premier jet" | "correction" = "premier jet";
  let cut = false;
  const answer = await answerVerified(
    text,
    async (prompt) => {
      tell({ kind: "reading", phase });
      const reply = await askAgent({
        agent: "cto",
        systemPrompt: system,
        question: prompt,
        // The question may name someone: local model only (ADR-0003).
        dataClass: "personal",
        journal: deps.journal,
        local: deps.local,
        timeoutMs: 300_000,
        onProgress: (chars) => tell({ kind: "writing", phase, chars }),
      });
      cut = reply.cut;
      return reply.text;
    },
    buildRepoIndex(deps.root),
    (missing) => {
      phase = "correction";
      tell({ kind: "revising", missing: missing.length });
    },
  );
  await deps.journal.append({
    agent: "cto",
    type: "cto.verified",
    payload: {
      claims: answer.checked.length,
      notFound: answer.checked.filter((c) => !c.found).length,
      revised: answer.revised,
      notFoundFirst: answer.unverifiedFirst.length,
    },
  });
  return {
    text: answer.text,
    summary: checkSummary(answer),
    cut,
    revised: answer.revised,
    seconds: Math.round((Date.now() - started) / 1000),
    documents: context.files.length,
  };
}
