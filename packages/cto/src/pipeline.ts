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
import { gitTrackedFiles, loadProjectContext } from "./context.ts";

/** What a review reads of the documentation: the rules, not the history. */
const ESSENTIAL_DOCS = ["CLAUDE.md", "README.md", "docs/charte.md", "docs/regles-du-code.md"];

/** One focused pass of a review (J3b): a file, its own small tool budget. */
export interface ReviewPass {
  readonly label: string;
  readonly prompt: string;
}
const PASS_TOOL_CALLS = 3;
const PASS_WINDOW_MS = 90_000;
const PASS_TIMEOUT_MS = 240_000;
const NOTHING = /^\s*\**\s*aucun d[ée]faut/i;

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
  | { readonly kind: "tool"; readonly tool: string; readonly target: string }
  | { readonly kind: "pass"; readonly n: number; readonly of: number; readonly label: string };

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
  options: {
    readonly kind?: "question" | "review" | "conformity";
    readonly maxCalls?: number;
    /** A review in focused passes (J3b): one ask each, results gathered by file. */
    readonly passes?: readonly ReviewPass[];
  } = {},
): Promise<CtoReply> {
  const started = Date.now();
  const review = options.kind === "review";
  // A review has the diff and the code: only the essential documentation, so
  // that reading the prompt stays short (all of it is ~60 k tokens).
  const context = review
    ? loadProjectContext(deps.root, {
        tracked: (root) => gitTrackedFiles(root).filter((p) => ESSENTIAL_DOCS.includes(p)),
      })
    : loadProjectContext(deps.root);
  const system = ctoSystemPrompt("Cénacle", context);
  const tell = (progress: CtoProgress) => {
    try {
      deps.onProgress?.(progress);
    } catch {
      // Progress is display only: a failing display never costs the answer.
    }
  };
  const phase: "premier jet" | "correction" = "premier jet";
  let cut = false;
  const { tools, stats } = createReadTools(view, {
    ...(options.maxCalls === undefined ? {} : { maxCalls: options.maxCalls }),
    // Tools stop well before the model's timeout: he then answers with what he read.
    windowMs: review ? 240_000 : options.kind === "conformity" ? 150_000 : 120_000,
    onUse: (use) => tell({ kind: "tool", tool: use.tool, target: use.target.slice(0, 120) }),
  });
  const totals = { calls: 0, refused: 0 };
  /** One pass: its own tool budget, its own timeout; a failure is said, never fatal. */
  const runPass = async (pass: ReviewPass, n: number, of: number): Promise<string | null> => {
    tell({ kind: "pass", n, of, label: pass.label });
    const own = createReadTools(view, {
      maxCalls: PASS_TOOL_CALLS,
      windowMs: PASS_WINDOW_MS,
      onUse: (use) => tell({ kind: "tool", tool: use.tool, target: use.target.slice(0, 120) }),
    });
    try {
      const reply = await askAgent({
        agent: "cto",
        systemPrompt: system,
        question: pass.prompt,
        dataClass: "personal",
        journal: deps.journal,
        local: deps.local,
        timeoutMs: PASS_TIMEOUT_MS,
        onProgress: (chars) => tell({ kind: "writing", phase, chars }),
        tools: own.tools,
      });
      cut = cut || reply.cut;
      return NOTHING.test(reply.text) ? null : reply.text;
    } catch {
      return "(relecture de ce fichier interrompue : délai ou modèle indisponible)";
    } finally {
      totals.calls += own.stats.calls;
      totals.refused += own.stats.refused;
    }
  };
  const passes = options.passes;
  const answer = await answerVerified(
    prompt,
    async (text) => {
      if (passes !== undefined && passes.length > 0) {
        const sections: string[] = [];
        const clean: string[] = [];
        for (const [i, pass] of passes.entries()) {
          const found = await runPass(pass, i + 1, passes.length);
          if (found === null) clean.push(`\`${pass.label}\``);
          else sections.push(`## \`${pass.label}\`\n\n${found.trim()}`);
        }
        if (clean.length > 0) sections.push(`Sans constat : ${clean.join(", ")}.`);
        return sections.length > 0 ? sections.join("\n\n") : "Aucun défaut trouvé.";
      }
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
        // A review and the compliance look read more; the latter reads all the documentation.
        timeoutMs: review ? 900_000 : options.kind === "conformity" ? 600_000 : 300_000,
        onProgress: (chars) => tell({ kind: "writing", phase, chars }),
        tools,
      });
      cut = reply.cut;
      return reply.text;
    },
    { ...buildRepoIndex(deps.root), view },
    undefined,
    // With tools, no rewrite by the model (it would try to call tools it no
    // longer has, or drop what it read): the code marks what is missing.
    "annotate",
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
      toolCalls: stats.calls + totals.calls,
      toolRefused: stats.refused + totals.refused,
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
