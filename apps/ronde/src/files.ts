/**
 * The ronde's two files, written whole (ADR-0040, R2): first under a name of
 * their own, then renamed over the old one — a reader never sees half a
 * verdict. Mode 600: the machines' state is mine alone to read.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type RondeState, verdictText, worstState } from "@cenacle/securite";
import type { PassResult } from "./pass.ts";

export function writeWhole(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const draft = `${path}.en-cours`;
  writeFileSync(draft, text, { mode: 0o600 });
  // A draft left by an earlier crash keeps its old mode: set it again.
  chmodSync(draft, 0o600);
  renameSync(draft, path);
}

/** A file's text, or null when it is absent; any other failure is thrown. */
export function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * What a pass leaves: the page's file always (it says why no machine is
 * read), the verdict only when machines were judged — and none at all when
 * none were: an old verdict must never outlive a file that stopped naming
 * its machines. The state written, or null when there is no verdict.
 */
export function leaveFiles(
  result: PassResult,
  paths: { readonly verdict: string; readonly bulletins: string },
  instantSeconds: number,
): RondeState | null {
  writeWhole(paths.bulletins, `${JSON.stringify(result.bulletins)}\n`);
  if (result.hosts.length === 0) {
    rmSync(paths.verdict, { force: true });
    return null;
  }
  writeWhole(paths.verdict, verdictText(result.hosts, instantSeconds));
  return worstState(result.hosts.map((h) => h.state));
}
