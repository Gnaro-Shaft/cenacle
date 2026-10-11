/**
 * Preparing a fix (J6c, ADR-0025), and nothing else: in a working copy of
 * its own (git worktree, from origin/main, in a temporary folder) — never the
 * checkout my services run from — the agent updates the lock file only
 * (`npm install <name>@<version> --package-lock-only --ignore-scripts`: no
 * code of the new package runs on the Mac), checks that only package files
 * changed, commits, pushes a branch `securite/correctif-…` and opens a pull
 * request. The CI tests it, on a throwaway machine. It never merges, never
 * pushes to main, never forces. Whatever fails, the working copy goes, and
 * a branch that was not pushed is removed.
 */
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import type { Run } from "./checks.ts";

export type FixStep = "fetch" | "worktree" | "npm" | "diff" | "commit" | "push" | "pr";
export type FixResult =
  | { readonly ok: true; readonly url: string; readonly branch: string }
  | { readonly ok: false; readonly step: FixStep };

export interface FixDeps {
  readonly run: Run;
  /** The repository my services run from: only its .git is touched (fetch, worktree). */
  readonly root: string;
  readonly tmpRoot: string;
  readonly git: string;
  readonly npm: string;
  readonly gh: string;
  /** A draft pull request (the trial run). */
  readonly draft?: boolean;
}

export interface FixRequest {
  readonly findingId: number;
  readonly name: string;
  readonly version: string;
}

export const ONLY_PACKAGE_FILES =
  /^(?:package\.json|package-lock\.json|(?:apps|packages)\/[a-z0-9-]{1,60}\/package\.json)$/;
const BRANCH = /^securite\/correctif-[a-z0-9._-]{1,120}$/;
export const PR_URL =
  /^https:\/\/github\.com\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}\/pull\/\d{1,7}$/;

export function branchFor(name: string, version: string): string | null {
  const slug = `${name.replace(/^@/, "").replace(/\//g, "-")}-${version}`.toLowerCase();
  const branch = `securite/correctif-${slug}`;
  return BRANCH.test(branch) ? branch : null;
}

export async function prepareFix(req: FixRequest, deps: FixDeps): Promise<FixResult> {
  const branch = branchFor(req.name, req.version);
  if (branch === null) return { ok: false, step: "worktree" };
  const at = (cwd: string) => (file: string, args: string[]) => deps.run(file, args, cwd);
  const inRoot = at(deps.root);
  let dir: string | null = null;
  let pushed = false;
  try {
    if ((await inRoot(deps.git, ["fetch", "--quiet", "origin", "main"])).code !== 0) {
      return { ok: false, step: "fetch" };
    }
    dir = await mkdtemp(join(deps.tmpRoot, "cenacle-correctif-"));
    if (
      (await inRoot(deps.git, ["worktree", "add", "-b", branch, dir, "origin/main"])).code !== 0
    ) {
      return { ok: false, step: "worktree" };
    }
    const inCopy = at(dir);
    const npm = await inCopy(deps.npm, [
      "install",
      `${req.name}@${req.version}`,
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ]);
    if (npm.code !== 0) return { ok: false, step: "npm" };
    const changed = (await inCopy(deps.git, ["diff", "--name-only"])).stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "");
    if (changed.length === 0 || !changed.every((f) => ONLY_PACKAGE_FILES.test(f))) {
      return { ok: false, step: "diff" };
    }
    const message = `fix(securite): ${req.name} ${req.version} — correctif de la faille du constat n°${req.findingId}`;
    if ((await inCopy(deps.git, ["commit", "--quiet", "-a", "-m", message])).code !== 0) {
      return { ok: false, step: "commit" };
    }
    if ((await inCopy(deps.git, ["push", "--quiet", "-u", "origin", branch])).code !== 0) {
      return { ok: false, step: "push" };
    }
    pushed = true;
    const body = [
      `Préparée par l'agent sécurité de Cénacle, sur ma demande (🔧, constat n°${req.findingId}).`,
      "",
      `- \`${req.name}\` passe en \`${req.version}\` (version corrigée publiée).`,
      "- Seul le fichier de verrouillage est mis à jour (`--package-lock-only --ignore-scripts`) : aucun code du paquet n'a tourné sur le Mac.",
      "- **La CI teste** ; **la fusion reste à moi**. L'agent ne fusionne jamais.",
    ].join("\n");
    const pr = await inCopy(deps.gh, [
      "pr",
      "create",
      "--base",
      "main",
      "--head",
      branch,
      "--title",
      `Sécurité : ${req.name} ${req.version} (constat n°${req.findingId})`,
      "--body",
      body,
      ...(deps.draft === true ? ["--draft"] : []),
    ]);
    const url = pr.stdout.trim().split("\n").at(-1)?.trim() ?? "";
    if (pr.code !== 0 || !PR_URL.test(url)) return { ok: false, step: "pr" };
    return { ok: true, url, branch };
  } catch {
    return { ok: false, step: dir === null ? "worktree" : "commit" };
  } finally {
    if (dir !== null)
      await inRoot(deps.git, ["worktree", "remove", "--force", dir]).catch(() => {});
    // A branch that never left the Mac is removed; a pushed one stays with its PR.
    if (!pushed) await inRoot(deps.git, ["branch", "-D", branch]).catch(() => {});
  }
}
