/**
 * The ronde's two files, written whole (ADR-0040, R2): first under a name of
 * their own, then renamed over the old one — a reader never sees half a
 * verdict. Mode 600: the machines' state is mine alone to read.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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
