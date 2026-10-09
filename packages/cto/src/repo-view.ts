/**
 * The repository as the CTO may see it (ADR-0021): git objects at one ref —
 * HEAD for a question, the branch under review for a review — never the disk.
 * No path is ever resolved on the filesystem: no `..`, no symlink followed (a
 * link entry is not a file), nothing untracked. The documentation's rules
 * hold: never `.env*`, `*.local.toml` nor `fixtures/`; a binary, an oversized
 * file, or one whose text looks like a credential is refused whole.
 */
import { execFileSync } from "node:child_process";
import { DENIED, SECRET_LIKE } from "./context.ts";

/** The largest file the CTO may read. */
export const MAX_VIEW_FILE = 400_000;

export type Refusal = "unknown" | "denied" | "too_big" | "binary" | "secret_like";

export class ViewRefusal extends Error {
  readonly reason: Refusal;
  constructor(path: string, reason: Refusal) {
    super(`${path} : refusé (${reason})`);
    this.name = "ViewRefusal";
    this.reason = reason;
  }
}

export interface RepoView {
  readonly ref: string;
  /** Every regular file the CTO may see at this ref, sorted. */
  files(): readonly string[];
  /** The text of a file, or a ViewRefusal. */
  read(path: string): string;
  /** Lines of a readable file, or null if it is not one. */
  lines(path: string): number | null;
  /** Literal search (not a regex): `path:line: text`, at most `limit` hits. */
  search(text: string, limit: number): string[];
}

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/;

export function gitView(root: string, ref = "HEAD"): RepoView {
  if (!SAFE_REF.test(ref) || ref.includes(".."))
    throw new Error(`invalid ref ${JSON.stringify(ref)}`);
  const git = (args: string[], max = 16_000_000) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: max });
  const commit = git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).trim();
  // Regular files only (100644, 100755): links (120000) and submodules are not files.
  const files = git(["ls-tree", "-r", "-z", "--full-tree", commit])
    .split("\0")
    .filter((e) => /^100(644|755) blob /.test(e))
    .map((e) => e.slice(e.indexOf("\t") + 1))
    .filter((p) => !DENIED.test(p))
    .sort();
  const known = new Set(files);
  const cache = new Map<string, string | ViewRefusal>();

  function read(path: string): string {
    const cached = cache.get(path);
    if (cached !== undefined) {
      if (cached instanceof ViewRefusal) throw cached;
      return cached;
    }
    let result: string | ViewRefusal;
    if (DENIED.test(path)) result = new ViewRefusal(path, "denied");
    else if (!known.has(path)) result = new ViewRefusal(path, "unknown");
    else if (Number(git(["cat-file", "-s", `${commit}:${path}`]).trim()) > MAX_VIEW_FILE) {
      result = new ViewRefusal(path, "too_big");
    } else {
      const text = git(["show", `${commit}:${path}`], MAX_VIEW_FILE * 4);
      if (text.includes("\u0000")) result = new ViewRefusal(path, "binary");
      else if (SECRET_LIKE.some((re) => re.test(text)))
        result = new ViewRefusal(path, "secret_like");
      else result = text;
    }
    cache.set(path, result);
    if (result instanceof ViewRefusal) throw result;
    return result;
  }

  const lines = (path: string): number | null => {
    try {
      return read(path).split("\n").length;
    } catch {
      return null;
    }
  };

  return {
    ref,
    files: () => files,
    read,
    lines,
    search(text, limit) {
      if (text === "" || text.length > 200 || text.includes("\n")) return [];
      let out = "";
      try {
        // -F: literal; -I: no binary; the ref is a commit id, the text one argument.
        out = git(["grep", "-F", "-n", "-I", "--no-color", "-e", text, commit, "--"]);
      } catch {
        return []; // git grep exits 1 when nothing matches
      }
      const hits: string[] = [];
      for (const line of out.split("\n")) {
        const m = /^[0-9a-f]+:([^:]+):(\d+):(.*)$/.exec(line);
        if (m === null || m[1] === undefined) continue;
        // A denied, refused or secret-looking file never shows a line.
        if (!known.has(m[1]) || lines(m[1]) === null) continue;
        hits.push(`${m[1]}:${m[2]}: ${(m[3] ?? "").trim().slice(0, 160)}`);
        if (hits.length >= limit) break;
      }
      return hits;
    },
  };
}
