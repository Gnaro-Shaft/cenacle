/**
 * Does what the CTO cites exist in the repository? (phase 6, J1 — ADR-0017)
 * Deterministic, no AI. Only versioned files are looked at, never an .env*,
 * a *.local.toml, fixtures/, a symbolic link or a binary file — a name found
 * only there counts as not found. Only "found" or "not found" comes out,
 * never a file's content.
 */
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Claim } from "./claims.ts";
import { gitTrackedFiles } from "./context.ts";

export interface RepoIndex {
  readonly files: ReadonlySet<string>;
  readonly scripts: ReadonlySet<string>;
  readonly adrs: ReadonlySet<string>;
  /** Whether a name appears in a readable versioned file. */
  has(name: string): boolean;
}

export interface Checked {
  readonly claim: Claim;
  readonly found: boolean;
}

const DENIED = /(^|\/)\.env|\.local\.toml$|(^|\/)fixtures\//i;
const MAX_FILE = 400_000;

export function buildRepoIndex(
  root: string,
  tracked: (root: string) => string[] = gitTrackedFiles,
): RepoIndex {
  const files = tracked(root);
  const texts: string[] = [];
  for (const path of files) {
    if (DENIED.test(path) || path.split("/").includes("..")) continue;
    try {
      const st = lstatSync(join(root, path));
      if (!st.isFile() || st.size > MAX_FILE) continue;
      const text = readFileSync(join(root, path), "utf8");
      if (!text.includes("\0")) texts.push(text);
    } catch {
      // a file listed by git but gone: nothing to search in it
    }
  }
  let scripts: string[] = [];
  try {
    scripts = Object.keys(
      JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts ?? {},
    );
  } catch {
    scripts = [];
  }
  const haystack = texts.join("\n\u0000\n");
  const adrs = new Set(
    files.flatMap((f) => {
      const m = /^docs\/adr\/(\d{4})-[^/]+\.md$/.exec(f);
      return m?.[1] === undefined ? [] : [m[1]];
    }),
  );
  return {
    files: new Set(files.filter((f) => !DENIED.test(f))),
    scripts: new Set(scripts),
    adrs,
    has: (name) => name.length >= 3 && haystack.includes(name),
  };
}

export function verifyClaims(claims: readonly Claim[], index: RepoIndex): Checked[] {
  return claims.map((claim) => {
    switch (claim.kind) {
      case "adr":
        return { claim, found: index.adrs.has(claim.value) };
      case "script":
        return { claim, found: index.scripts.has(claim.value) };
      case "path": {
        const p = claim.value.replace(/\/$/, "");
        if (p.startsWith("/") || p.split("/").includes("..") || DENIED.test(p))
          return { claim, found: false };
        const found = index.files.has(p) || [...index.files].some((f) => f.startsWith(`${p}/`));
        return { claim, found };
      }
      case "name":
        return { claim, found: index.has(claim.value) };
      default: {
        const unknown: never = claim.kind;
        throw new Error(`unknown claim kind ${JSON.stringify(unknown)}`);
      }
    }
  });
}
