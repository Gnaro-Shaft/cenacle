/**
 * What the CTO reads to answer (phase 6, J1 — ADR-0017): chosen by code,
 * never by the model. The versioned documentation of a project — README,
 * CLAUDE.md, docs/ — in a fixed order and a size budget.
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

export interface ProjectContext {
  readonly files: readonly ContextFile[];
  readonly skipped: readonly Skipped[];
  readonly chars: number;
}

/** Characters of documentation at most: the local model holds far more, the answer stays fast. */
export const CONTEXT_BUDGET = 120_000;
const MAX_FILE = 200_000;

/** Documentation, by path: the only files ever considered. */
const DOCUMENTATION = /^(README\.md|CLAUDE\.md|docs\/.+\.md|[^/]+\/[^/]+\/README\.md)$/;
/** Never read, whatever the allow-list says. */
const DENIED = /(^|\/)\.env|\.local\.toml$|(^|\/)fixtures\//i;
/** Text that looks like a credential: the whole file is left out. */
export const SECRET_LIKE: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:sk|rk|pk)[-_](?:live|test|proj)?[-_]?[A-Za-z0-9]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9_\-/+=]{12,}/i,
];

/** Charter and decisions first, then the rest by path: the same order at every call. */
function rank(path: string): string {
  const first = ["CLAUDE.md", "README.md", "docs/charte.md", "docs/adr/README.md"];
  const i = first.indexOf(path);
  if (i !== -1) return `0${i}`;
  if (path.startsWith("docs/adr/")) return `1${path}`;
  return `2${path}`;
}

export function gitTrackedFiles(root: string): string[] {
  const out = execFileSync("git", ["-C", root, "ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 16_000_000,
  });
  return out.split("\0").filter((p) => p !== "");
}

export function loadProjectContext(
  root: string,
  options: { readonly budget?: number; readonly tracked?: (root: string) => string[] } = {},
): ProjectContext {
  const budget = options.budget ?? CONTEXT_BUDGET;
  const realRoot = realpathSync(root);
  const files: ContextFile[] = [];
  const skipped: Skipped[] = [];
  let chars = 0;
  const candidates = (options.tracked ?? gitTrackedFiles)(root)
    .filter((p) => DOCUMENTATION.test(p))
    .sort((a, b) => rank(a).localeCompare(rank(b)));
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
    if (chars + text.length > budget) {
      skipped.push({ path, reason: "budget" });
      continue;
    }
    files.push({ path, text });
    chars += text.length;
  }
  return { files, skipped, chars };
}
