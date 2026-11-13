/**
 * The fingerprint of the page's sources (ADR-0037, point 3). The build writes
 * it next to the built page; the server compares it at start, and refuses a
 * page built from other sources: the page and the API never run two versions.
 * Tests and the built output are left out: they do not change what is served.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Written by the build in dist/, read by the server. */
export const SOURCES_STAMP = ".cenacle-sources";

const LEFT_OUT = new Set(["dist", "node_modules"]);

function files(dir: string, root: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return LEFT_OUT.has(e.name) ? [] : files(path, root);
    if (!e.isFile() || /\.test\.tsx?$/.test(e.name) || e.name.endsWith(".tsbuildinfo")) return [];
    return [relative(root, path).split(sep).join("/")];
  });
}

/** SHA-256 of every source file of the page (path and content), in a fixed order. */
export function pageSourcesHash(webDir: string): string {
  const hash = createHash("sha256");
  for (const file of files(webDir, webDir).sort()) {
    hash.update(`${file}\0${statSync(join(webDir, file)).size}\0`);
    hash.update(readFileSync(join(webDir, file)));
  }
  return hash.digest("hex");
}
