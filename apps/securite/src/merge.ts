/**
 * The only place where the security agent merges or closes a pull request
 * (J6d, ADR-0026) — and only because I pressed ✅ Fusionner or ❌ Fermer on
 * that very PR. Before merging, everything I saw is checked again: the PR is
 * open, aims at main, still on the commit the CI tested when the buttons
 * were sent, its CI green on it, and it touches package files only. gh is
 * told that commit (--match-head-commit): a commit pushed in between makes
 * the merge fail rather than merge something I never saw. Never delegable.
 */
import { PR_VIEW_FIELDS, type PrView, parsePrView } from "@cenacle/securite";
import type { Run } from "./checks.ts";
import { ONLY_PACKAGE_FILES } from "./fix.ts";

export interface PrOps {
  readonly run: Run;
  readonly root: string;
  readonly gh: string;
}

export type MergeRefusal = "unknown" | "state" | "moved" | "ci" | "base" | "files" | "gh";
export type MergeOutcome =
  | { readonly ok: true; readonly clean: boolean }
  | { readonly ok: false; readonly reason: MergeRefusal };

export async function viewPr(url: string, ops: PrOps): Promise<PrView> {
  const out = await ops.run(ops.gh, ["pr", "view", url, "--json", PR_VIEW_FIELDS], ops.root);
  return out.code === 0 ? parsePrView(out.stdout) : parsePrView("");
}

/** Merges on my request, only if nothing moved since the CI I saw. */
export async function mergeOnRequest(url: string, sha: string, ops: PrOps): Promise<MergeOutcome> {
  const v = await viewPr(url, ops);
  if (v.status === "unknown") return { ok: false, reason: "unknown" };
  if (v.status === "merged" || v.status === "closed") return { ok: false, reason: "state" };
  if (v.headSha !== sha) return { ok: false, reason: "moved" };
  if (v.status !== "ci_passed") return { ok: false, reason: "ci" };
  if (v.base !== "main") return { ok: false, reason: "base" };
  if (v.files.length === 0 || !v.files.every((f) => ONLY_PACKAGE_FILES.test(f))) {
    return { ok: false, reason: "files" };
  }
  const merged = await ops.run(
    ops.gh,
    ["pr", "merge", url, "--merge", "--match-head-commit", sha],
    ops.root,
  );
  if (merged.code !== 0) return { ok: false, reason: "gh" };
  return { ok: true, clean: v.commits === 1 };
}

/** Closes on my request, and removes its branch. */
export async function closeOnRequest(url: string, ops: PrOps): Promise<boolean> {
  return (await ops.run(ops.gh, ["pr", "close", url, "--delete-branch"], ops.root)).code === 0;
}
