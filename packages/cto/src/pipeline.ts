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
import { validQuestion } from "./question.ts";
import { gitView, type RepoView } from "./repo-view.ts";
import { createReadTools } from "./tools.ts";
import { buildRepoIndex } from "./verify.ts";

export { MAX_QUESTION, QuestionError, validQuestion } from "./question.ts";

export type CtoProgress =
  | { readonly kind: "queued"; readonly ahead: number }
  | { readonly kind: "reading"; readonly phase: "premier jet" | "correction" }
  | {
      readonly kind: "writing";
      readonly phase: "premier jet" | "correction";
      readonly chars: number;
    }
  | { readonly kind: "revising"; readonly missing: number }
  | { readonly kind: "tool"; readonly tool: string; readonly target: string };

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
  // The code at HEAD: what is committed.
  return runCto(validQuestion(question), gitView(deps.root, "HEAD"), deps);
}

/**
 * The shared circuit (ADR-0017, ADR-0021): the documentation in the prompt,
 * the code through three read-only tools on `view`, every reference checked
 * — `path:line` in that same view — and one rewrite if anything is missing.
 */
export async function runCto(
  prompt: string,
  view: RepoView,
  deps: CtoDeps,
  options: { readonly kind?: "question" | "review"; readonly maxCalls?: number } = {},
): Promise<CtoReply> {
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
  const { tools, stats } = createReadTools(view, {
    ...(options.maxCalls === undefined ? {} : { maxCalls: options.maxCalls }),
    onUse: (use) => tell({ kind: "tool", tool: use.tool, target: use.target.slice(0, 120) }),
  });
  const answer = await answerVerified(
    prompt,
    async (text) => {
      tell({ kind: "reading", phase });
      const reply = await askAgent({
        agent: "cto",
        systemPrompt: system,
        question: text,
        // The question may name someone: local model only (ADR-0003).
        dataClass: "personal",
        journal: deps.journal,
        local: deps.local,
        // Tools mean several model turns: a review reads more.
        timeoutMs: options.kind === "review" ? 600_000 : 300_000,
        onProgress: (chars) => tell({ kind: "writing", phase, chars }),
        tools,
      });
      cut = reply.cut;
      return reply.text;
    },
    { ...buildRepoIndex(deps.root), view },
    (missing) => {
      phase = "correction";
      tell({ kind: "revising", missing: missing.length });
    },
  );
  await deps.journal.append({
    agent: "cto",
    type: "cto.verified",
    payload: {
      kind: options.kind ?? "question",
      claims: answer.checked.length,
      notFound: answer.checked.filter((c) => !c.found).length,
      revised: answer.revised,
      notFoundFirst: answer.unverifiedFirst.length,
      toolCalls: stats.calls,
      toolRefused: stats.refused,
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
