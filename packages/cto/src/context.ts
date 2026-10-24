/**
 * What the CTO may read in his prompt (phase 6, J1 — ADR-0017): chosen by
 * code, never by the model. The versioned documentation of a project —
 * README, CLAUDE.md, docs/ — admitted file by file, in a fixed order; which
 * of it goes into a prompt is chosen in selection.ts (ADR-0033).
 *
 * Never: an .env* file, a *.local.toml, fixtures/, a symbolic link, anything
 * outside the repository, a binary or oversized file, or a file whose text
 * looks like a key or a secret (dropped whole). What is skipped is reported
 * by path and reason, never by content.
 */
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";

export interface ContextFile {
  readonly path: string;
  readonly text: string;
}

export interface Skipped {
  readonly path: string;
  readonly reason:
    | "denied"
    | "symlink"
    | "outside"
    | "not_a_file"
    | "too_big"
    | "binary"
    | "secret_like"
    | "budget";
}

export interface Admitted {
  /** In the fixed order of orderDocumentation. */
  readonly files: readonly ContextFile[];
  readonly skipped: readonly Skipped[];
}

const MAX_FILE = 200_000;

/** Documentation, by path: the only files ever considered. */
const DOCUMENTATION = /^(README\.md|CLAUDE\.md|docs\/.+\.md|[^/]+\/[^/]+\/README\.md)$/;
/**
 * Measurement reports: figures, long, rarely the answer. Never in full in the
 * prompt, still readable by the CTO's tools (ADR-0021): the report of
 * 2026-10-20 alone (21 k characters) pushed the oldest phases out of the budget.
 */
export const READ_BY_TOOLS_ONLY = /^docs\/mesures\//;
/** Never read, whatever the allow-list says. */
export const DENIED = /(^|\/)\.env|\.local\.toml$|(^|\/)fixtures\//i;
/** Text that looks like a credential: the whole file is left out. */
export const SECRET_LIKE: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:sk|rk|pk)[-_](?:live|test|proj)?[-_]?[A-Za-z0-9]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  // A value, not code: a function call (`mailPassword(cadre)`) or `process.env.X` is not one.
  /\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9_\-/+=]{12,}(?![A-Za-z0-9_\-/+=(.])/i,
];

const FIRST = ["CLAUDE.md", "README.md", "docs/charte.md", "docs/adr/README.md"];
const PHASE = /^docs\/phase-(\d+)\.md$/;
const ADR = /^docs\/adr\/(\d{4})-/;
/** How many of the latest phases count as current work. */
const CURRENT_PHASES = 2;

/**
 * What matters first, so that what the budget leaves out is the least useful
 * (the same order at every call): the charter and its kin; the current phases
 * and security; decisions, newest first; the rest by path; then older phases,
 * which are history. Phases are numbered: a new one moves ahead by itself.
 */
function documentationKey(paths: readonly string[]): (p: string) => [number, number, string] {
  const phase = (p: string) => Number(PHASE.exec(p)?.[1] ?? Number.NaN);
  const current = new Set(
    paths
      .map(phase)
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => b - a)
      .slice(0, CURRENT_PHASES),
  );
  return (p: string): [number, number, string] => {
    const first = FIRST.indexOf(p);
    if (first !== -1) return [0, first, ""];
    const n = phase(p);
    if (!Number.isNaN(n)) return current.has(n) ? [1, -n, ""] : [4, -n, ""];
    if (p.startsWith("docs/securite/")) return [1, 0, p];
    const adr = ADR.exec(p)?.[1];
    if (adr !== undefined) return [2, -Number(adr), p];
    return [3, 0, p];
  };
}

export function orderDocumentation(paths: readonly string[]): string[] {
  const key = documentationKey(paths);
  return [...paths].sort((a, b) => {
    const [ta, na, sa] = key(a);
    const [tb, nb, sb] = key(b);
    return ta - tb || na - nb || (sa < sb ? -1 : sa > sb ? 1 : 0);
  });
}

/**
 * The core (ADR-0033, § 1): the charter and its kin, the current phases and
 * security — what every prompt holds in full, whatever the question.
 */
export function corePaths(paths: readonly string[]): Set<string> {
  const key = documentationKey(paths);
  return new Set(paths.filter((p) => key(p)[0] <= 1));
}

export function gitTrackedFiles(root: string): string[] {
  const out = execFileSync("git", ["-C", root, "ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 16_000_000,
  });
  return out.split("\0").filter((p) => p !== "");
}

/** Every documentation file that may be shown, read once; measurement reports included. */
export function admitDocumentation(
  root: string,
  tracked: (root: string) => string[] = gitTrackedFiles,
): Admitted {
  const realRoot = realpathSync(root);
  const files: ContextFile[] = [];
  const skipped: Skipped[] = [];
  const candidates = orderDocumentation(tracked(root).filter((p) => DOCUMENTATION.test(p)));
  for (const path of candidates) {
    if (DENIED.test(path)) {
      skipped.push({ path, reason: "denied" });
      continue;
    }
    if (isAbsolute(path) || path.split("/").includes("..")) {
      skipped.push({ path, reason: "outside" });
      continue;
    }
    const full = join(realRoot, path);
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(full);
    } catch {
      skipped.push({ path, reason: "not_a_file" });
      continue;
    }
    if (stat.isSymbolicLink()) {
      skipped.push({ path, reason: "symlink" });
      continue;
    }
    if (!realpathSync(full).startsWith(realRoot + sep)) {
      skipped.push({ path, reason: "outside" });
      continue;
    }
    if (!stat.isFile()) {
      skipped.push({ path, reason: "not_a_file" });
      continue;
    }
    if (stat.size > MAX_FILE) {
      skipped.push({ path, reason: "too_big" });
      continue;
    }
    const text = readFileSync(full, "utf8");
    if (text.includes("\0")) {
      skipped.push({ path, reason: "binary" });
      continue;
    }
    if (SECRET_LIKE.some((re) => re.test(text))) {
      skipped.push({ path, reason: "secret_like" });
      continue;
    }
    files.push({ path, text });
  }
  return { files, skipped };
}
