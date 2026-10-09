/**
 * The CTO's read-only tools (ADR-0021): three, fixed here — the model can
 * neither add one nor reach anything else. They see the repository through a
 * RepoView (git objects at one ref, the documentation's rules). No network,
 * no write, no execution. A budget per question bounds them: beyond it, a tool
 * answers "budget exhausted" and the CTO must answer with what he has.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import type { RepoView } from "./repo-view.ts";

export const MAX_TOOL_CALLS = 6;
export const MAX_TOOL_CHARS = 150_000;
const MAX_LINES_PER_READ = 400;
/** Lines read when the model gives no end: each turn stays light. */
const DEFAULT_LINES = 200;
const MAX_CHARS_PER_RESULT = 20_000;
const MAX_LISTED = 300;
const MAX_HITS = 50;

export interface ToolStats {
  calls: number;
  refused: number;
  chars: number;
}

export interface ToolUse {
  readonly tool: "lister" | "lire" | "chercher";
  readonly target: string;
}

export class ToolBudgetError extends Error {
  constructor() {
    super(
      "Budget d'outils épuisé. N'appelle plus aucun outil : écris maintenant ta réponse finale avec ce que tu as déjà lu.",
    );
    this.name = "ToolBudgetError";
  }
}

/** A folder as the model writes it: "", ".", "./apps/", "apps/cli" — never "..". */
function folder(raw: string): string {
  const parts = raw
    .trim()
    .replace(/^\.\/?/, "")
    .split("/")
    .filter((p) => p !== "" && p !== ".");
  if (parts.includes("..")) throw new Error("chemin refusé : `..` n'est pas permis");
  return parts.join("/");
}

const LIST = Type.Object({ dossier: Type.String() });
const READ = Type.Object({
  chemin: Type.String(),
  debut: Type.Optional(Type.Number()),
  fin: Type.Optional(Type.Number()),
});
const SEARCH = Type.Object({ texte: Type.String() });

export function createReadTools(
  view: RepoView,
  options: {
    readonly maxCalls?: number;
    readonly maxChars?: number;
    /**
     * How long the tools may be used, from the first call (ms): past it, they
     * say "budget exhausted" and the CTO answers with what he has, instead of
     * being cut by the timeout. Counted from the first call, so that reading
     * the documentation (slow when cold) never eats it.
     */
    readonly windowMs?: number;
    readonly onUse?: (use: ToolUse) => void;
  } = {},
  // biome-ignore lint/suspicious/noExplicitAny: the agent's own type for a mixed tool list.
): { readonly tools: AgentTool<any>[]; readonly stats: ToolStats } {
  const stats: ToolStats = { calls: 0, refused: 0, chars: 0 };
  let deadline: number | undefined;
  const maxCalls = options.maxCalls ?? MAX_TOOL_CALLS;
  const maxChars = options.maxChars ?? MAX_TOOL_CHARS;

  /** Counts the call, runs it, bounds its result; a refusal is counted, then thrown. */
  const run = (use: ToolUse, body: () => string) => {
    if (deadline === undefined && options.windowMs !== undefined) {
      deadline = Date.now() + options.windowMs;
    }
    const late = deadline !== undefined && Date.now() >= deadline;
    if (stats.calls >= maxCalls || stats.chars >= maxChars || late) throw new ToolBudgetError();
    stats.calls++;
    try {
      options.onUse?.(use);
    } catch {
      // Progress is display only.
    }
    let text: string;
    try {
      text = body();
    } catch (error) {
      stats.refused++;
      throw error;
    }
    if (text.length > MAX_CHARS_PER_RESULT) {
      text = `${text.slice(0, MAX_CHARS_PER_RESULT)}\n… (coupé : lis une tranche plus courte)`;
    }
    stats.chars += text.length;
    return { content: [{ type: "text" as const, text }], details: {} };
  };

  const list: AgentTool<typeof LIST> = {
    name: "lister",
    label: "lister",
    description:
      'Liste les fichiers suivis du dépôt sous un dossier ("" pour la racine, ex. "apps/cli/src").',
    parameters: LIST,
    execute: async (_id, params: Static<typeof LIST>) =>
      run({ tool: "lister", target: params.dossier }, () => {
        const prefix = folder(params.dossier);
        const all = view.files().filter((f) => prefix === "" || f.startsWith(`${prefix}/`));
        if (all.length === 0) return "(aucun fichier sous ce dossier)";
        const shown = all.slice(0, MAX_LISTED).join("\n");
        return all.length > MAX_LISTED
          ? `${shown}\n… ${all.length - MAX_LISTED} de plus : précise un sous-dossier`
          : shown;
      }),
  };
  const read: AgentTool<typeof READ> = {
    name: "lire",
    label: "lire",
    description: `Lit un fichier suivi du dépôt, des lignes debut à fin (${DEFAULT_LINES} lignes si fin manque, ${MAX_LINES_PER_READ} au plus), numérotées. Cherche d'abord, puis lis seulement les lignes utiles.`,
    parameters: READ,
    execute: async (_id, params: Static<typeof READ>) =>
      run({ tool: "lire", target: params.chemin }, () => {
        const lines = view.read(params.chemin.trim().replace(/^\.\//, "")).split("\n");
        const from = Math.max(1, Math.floor(params.debut ?? 1));
        if (from > lines.length) return `(le fichier n'a que ${lines.length} lignes)`;
        const to = Math.min(
          lines.length,
          Math.floor(params.fin ?? from + DEFAULT_LINES - 1),
          from + MAX_LINES_PER_READ - 1,
        );
        return lines
          .slice(from - 1, to)
          .map((line, i) => `${from + i}: ${line}`)
          .join("\n");
      }),
  };
  const search: AgentTool<typeof SEARCH> = {
    name: "chercher",
    label: "chercher",
    description: `Cherche un texte exact (pas une expression régulière) dans les fichiers suivis du dépôt ; ${MAX_HITS} résultats au plus, sous la forme chemin:ligne: texte.`,
    parameters: SEARCH,
    execute: async (_id, params: Static<typeof SEARCH>) =>
      run({ tool: "chercher", target: params.texte }, () => {
        const hits = view.search(params.texte, MAX_HITS);
        return hits.length === 0 ? "(aucun résultat)" : hits.join("\n");
      }),
  };
  return { tools: [list, read, search], stats };
}
