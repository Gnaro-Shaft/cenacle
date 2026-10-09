/**
 * The CTO reviews a branch (phase 6, J3 — ADR-0021). The code computes what
 * changed — a local branch against its merge base with main — never the model;
 * the CTO reads around it with his tools, at the branch's version, and returns
 * findings: severity, `path:line`, why, the test that would catch it. He never
 * comments anywhere: he advises, I decide.
 */
import { execFileSync } from "node:child_process";
import { DENIED, SECRET_LIKE } from "./context.ts";
import { type CtoDeps, type CtoReply, runCto } from "./pipeline.ts";
import { gitView } from "./repo-view.ts";
import { buildPasses } from "./review-passes.ts";

/** Diff characters given to the model at most: beyond, the files list and the tools. */
export const MAX_DIFF = 30_000;
/** A review reads more than a question. */
export const REVIEW_TOOL_CALLS = 12;

const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/;

export class ReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewError";
  }
}

/** A branch name as I may type it: no option, no range, no `..`. */
export function validBranch(name: unknown): string {
  if (
    typeof name !== "string" ||
    !BRANCH.test(name) ||
    name.includes("..") ||
    name.endsWith(".lock")
  ) {
    throw new ReviewError("nom de branche refusé");
  }
  return name;
}

export interface ReviewTarget {
  readonly label: string;
  readonly base: string;
  readonly head: string;
  readonly files: readonly string[];
  readonly diff: string;
  readonly truncated: boolean;
  /** Changed files left out of the diff: denied, or text that looks like a secret. */
  readonly withheld: readonly string[];
  /** Each file's own diff, uncut by the others (J3b: one pass per file). */
  readonly parts: readonly { readonly path: string; readonly diff: string }[];
}

function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64_000_000 });
}

/** What changed between two commits, as the model will see it. */
export function rangeTarget(root: string, base: string, head: string, label: string): ReviewTarget {
  const commit = (ref: string) => {
    try {
      return git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).trim();
    } catch {
      throw new ReviewError(`révision inconnue : ${ref}`);
    }
  };
  const [b, h] = [commit(base), commit(head)];
  const changed = git(root, ["diff", "--name-only", "-z", b, h]).split("\0").filter(Boolean);
  const withheld: string[] = [];
  const parts: Array<{ path: string; part: string }> = [];
  for (const path of changed) {
    if (DENIED.test(path)) {
      withheld.push(path);
      continue;
    }
    const part = git(root, ["diff", "--no-color", "--unified=5", b, h, "--", path]);
    if (SECRET_LIKE.some((re) => re.test(part))) withheld.push(path);
    else parts.push({ path, part });
  }
  // A huge diff (a generated or lock file) never hides the small changes:
  // it is replaced by a line, and every file fits whole or is named.
  let diff = "";
  let truncated = false;
  const left: string[] = [];
  for (const { path, part } of parts) {
    const piece =
      part.length > MAX_DIFF / 2
        ? `diff --git a/${path} b/${path}\n(diff trop long : ${part.length} caractères — lis ce fichier avec tes outils)\n`
        : part;
    if (piece !== part) truncated = true;
    if (diff.length + piece.length > MAX_DIFF) {
      truncated = true;
      left.push(path);
      continue;
    }
    diff += piece;
  }
  if (left.length > 0) diff += `\n(diff non montré, faute de place : ${left.join(", ")})\n`;
  return {
    label,
    base: b,
    head: h,
    files: changed.filter((p) => !withheld.includes(p)),
    diff,
    truncated,
    withheld,
    parts: parts.map(({ path, part }) => ({ path, diff: part })),
  };
}

/** A local branch against its merge base with main. */
export function branchTarget(root: string, name: string): ReviewTarget {
  const branch = validBranch(name);
  try {
    git(root, ["check-ref-format", "--branch", branch]);
    git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  } catch {
    throw new ReviewError(`branche locale introuvable : ${branch}`);
  }
  const base = git(root, ["merge-base", "main", `refs/heads/${branch}`]).trim();
  const target = rangeTarget(root, base, `refs/heads/${branch}`, branch);
  if (target.files.length === 0) throw new ReviewError(`rien à relire sur ${branch}`);
  return target;
}

export function reviewPrompt(t: ReviewTarget): string {
  return [
    `Relis ce changement (« ${t.label} ») comme le ferait un relecteur exigeant, avant sa fusion.`,
    "Cherche les vrais défauts : un comportement faux, un cas limite oublié, une erreur avalée, une course entre processus, une faille de sécurité ou de conformité, un test qui ne prouve pas ce qu'il dit. Pas de remarque de style.",
    "Tes outils lisent le code à la version de cette branche : ouvre ce qu'il faut autour du diff avant d'affirmer.",
    "Pour chaque constat : sa gravité (bloquant, important ou mineur), `chemin:ligne`, pourquoi c'est un défaut, et le test qui l'attraperait. Si tu ne trouves rien de réel, dis « Aucun défaut trouvé » : n'en invente pas.",
    `Fichiers changés : ${t.files.join(", ")}.`,
    t.withheld.length > 0
      ? `Écartés du diff (fichiers privés ou ressemblant à un secret) : ${t.withheld.length}.`
      : "",
    t.truncated
      ? "Le diff est incomplet (fichiers trop longs ou faute de place) : lis le reste avec tes outils."
      : "",
    "",
    "DIFF :",
    t.diff,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * The review itself (J3b): one focused pass per changed code file, each with
 * its dossier prepared by code; the tools on the branch's code.
 */
export function reviewCto(target: ReviewTarget, deps: CtoDeps): Promise<CtoReply> {
  const view = gitView(deps.root, target.head);
  const { passes } = buildPasses(target, view);
  return runCto(reviewPrompt(target), view, deps, {
    kind: "review",
    maxCalls: REVIEW_TOOL_CALLS,
    passes,
  });
}
