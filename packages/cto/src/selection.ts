/**
 * What goes into a prompt of the CTO (ADR-0033): the core, always, in full;
 * the map of every other admitted document, so that he knows what exists and
 * reads it with his tools; then the documents of the request, whole, most
 * relevant first, within the budget. All chosen by code (ADR-0017, § 3).
 *
 * Requests: a question (its documents by relevance), the compliance look
 * (docs/conformite/ and the latest ADRs), or "all" — every admitted document
 * in the fixed order, no map: the review's few essential documents, and the
 * former context, kept for the documentation bench only.
 */
import {
  type Admitted,
  admitDocumentation,
  type ContextFile,
  corePaths,
  gitTrackedFiles,
  READ_BY_TOOLS_ONLY,
  type Skipped,
} from "./context.ts";
import { rankByRelevance, titleOf } from "./relevance.ts";

/** Characters of documentation in a prompt at most: core, map and the request's documents. */
export const CONTEXT_BUDGET = 120_000;
/** The core and the map together: beyond, a decision is due, not a bigger budget (§ 5). */
export const CORE_AND_MAP_LIMIT = 60_000;
/** How many of the latest ADRs the compliance look reads in full. */
const LATEST_ADRS = 3;
const MAX_TITLE = 160;

export type ContextRequest =
  | { readonly kind: "question"; readonly text: string }
  | { readonly kind: "conformity" }
  | { readonly kind: "all" };

export interface MapEntry {
  readonly path: string;
  readonly title: string;
  /** An ADR's status: « acceptée », « proposée »… */
  readonly status?: string;
}

export interface ProjectContext {
  /** In full, in the order shown: the core first. */
  readonly files: readonly ContextFile[];
  /** How many of `files` are the core: the map is shown right after them (§ 1). */
  readonly core: number;
  /** Every admitted document outside the core: what the tools can read. */
  readonly map: readonly MapEntry[];
  readonly skipped: readonly Skipped[];
  /** Characters of documentation in the prompt: files and map. */
  readonly chars: number;
  /** Characters of the core and the map alone. */
  readonly coreAndMap: number;
}

const ADR = /^docs\/adr\/(\d{4})-/;
const STATUS = /^\*\*Statut\*\*\s*:\s*([\p{L}-]+)/mu;

function mapEntry(file: ContextFile): MapEntry {
  const title = titleOf(file).replace(/\s+/g, " ").slice(0, MAX_TITLE);
  const status = ADR.test(file.path) ? STATUS.exec(file.text)?.[1]?.toLowerCase() : undefined;
  return status === undefined ? { path: file.path, title } : { path: file.path, title, status };
}

/** One line of the map, as the prompt shows it. */
export function mapLine(entry: MapEntry): string {
  return `- ${entry.path} — ${entry.title}${entry.status === undefined ? "" : ` (${entry.status})`}`;
}

const mapChars = (map: readonly MapEntry[]): number =>
  map.reduce((sum, e) => sum + mapLine(e).length + 1, 0);

/** The documents a request wants in full, beyond the core, most wanted first. */
function wanted(request: ContextRequest, candidates: readonly ContextFile[]): string[] {
  if (request.kind === "question") return rankByRelevance(request.text, candidates);
  if (request.kind === "all") return candidates.map((f) => f.path);
  const latest = candidates
    .filter((f) => ADR.test(f.path))
    .map((f) => f.path)
    .sort()
    .reverse()
    .slice(0, LATEST_ADRS);
  const compliance = candidates
    .filter((f) => f.path.startsWith("docs/conformite/"))
    .map((f) => f.path);
  return [...compliance, ...latest];
}

export function selectContext(
  admitted: Admitted,
  request: ContextRequest,
  budget: number = CONTEXT_BUDGET,
): ProjectContext {
  const shown = admitted.files.filter((f) => !READ_BY_TOOLS_ONLY.test(f.path));
  const skipped = [...admitted.skipped];
  if (request.kind === "all") {
    const files: ContextFile[] = [];
    let chars = 0;
    for (const f of shown) {
      if (chars + f.text.length > budget) {
        skipped.push({ path: f.path, reason: "budget" });
        continue;
      }
      files.push(f);
      chars += f.text.length;
    }
    return { files, core: files.length, map: [], skipped, chars, coreAndMap: chars };
  }
  const core = corePaths(admitted.files.map((f) => f.path));
  const files = shown.filter((f) => core.has(f.path));
  const coreCount = files.length;
  const map = admitted.files.filter((f) => !core.has(f.path)).map(mapEntry);
  const coreAndMap = files.reduce((sum, f) => sum + f.text.length, 0) + mapChars(map);
  let chars = coreAndMap;
  const candidates = shown.filter((f) => !core.has(f.path));
  const byPath = new Map(candidates.map((f) => [f.path, f]));
  for (const path of wanted(request, candidates)) {
    const f = byPath.get(path);
    // Whole or not at all: what does not fit stays in the map.
    if (f === undefined || chars + f.text.length > budget) continue;
    files.push(f);
    chars += f.text.length;
  }
  return { files, core: coreCount, map, skipped, chars, coreAndMap };
}

export function loadProjectContext(
  root: string,
  options: {
    readonly request?: ContextRequest;
    readonly budget?: number;
    readonly tracked?: (root: string) => string[];
  } = {},
): ProjectContext {
  return selectContext(
    admitDocumentation(root, options.tracked ?? gitTrackedFiles),
    options.request ?? { kind: "all" },
    options.budget,
  );
}
