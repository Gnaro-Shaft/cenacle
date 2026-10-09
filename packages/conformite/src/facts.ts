/**
 * The facts the compliance checks compare (ADR-0022), gathered from the
 * repository: versioned files only — never `.env*`, `*.local.toml` nor
 * `fixtures/` — except, when asked (`local`), the four durations of the real
 * cadre.local.toml's [conservation], and nothing else of it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SECRET_FAMILIES } from "@cenacle/core";
import { buildRepoIndex, extractClaims, verifyClaims } from "@cenacle/cto";
import { parse } from "smol-toml";
import type { Facts } from "./checks.ts";

const DENIED = /(^|\/)\.env|\.local\.toml$|(^|\/)fixtures\//i;
/** Where the repository's own paths start. */
const REPO_PATH = /^(apps|packages|docs|deploy|scripts)\/|^[\w.-]+\.(toml|md|json|yaml|yml)$/;
/** Hosts that are never contacted: local, fictional, or a format identifier. */
const NOT_CONTACTED =
  /^(localhost|127\.0\.0\.1|.*\.test|.*\.example|example\.(com|org|net)|www\.apple\.com)$/;

function conservationOf(text: string, name: string): Record<string, number> {
  const raw = parse(text) as { conservation?: Record<string, unknown> };
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw.conservation ?? {})) {
    if (key.endsWith("_jours") && typeof value === "number") out[key] = value;
  }
  if (Object.keys(out).length === 0) throw new Error(`${name} : aucune durée dans [conservation]`);
  return out;
}

export function loadFacts(root: string, options: { readonly local?: boolean } = {}): Facts {
  const tracked = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter((p) => p !== "" && !DENIED.test(p));
  const known = new Set(tracked);
  const file = (path: string): string | null => {
    if (!known.has(path)) return null;
    try {
      return readFileSync(join(root, path), "utf8");
    } catch {
      return null;
    }
  };
  const must = (path: string): string => {
    const text = file(path);
    if (text === null) throw new Error(`${path} est introuvable`);
    return text;
  };

  const cadres = ["cadre.toml", "cadre.local.example.toml"].map((name) => ({
    name,
    conservation: conservationOf(must(name), name),
  }));
  const local = join(root, "cadre.local.toml");
  if (options.local === true && existsSync(local)) {
    cadres.push({
      name: "cadre.local.toml",
      conservation: conservationOf(readFileSync(local, "utf8"), "cadre.local.toml"),
    });
  }

  const code = tracked.filter(
    (p) => /^(apps|packages)\/[^/]+\/src\/.+\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p),
  );
  const hosts: { host: string; path: string }[] = [];
  const agents = new Set<string>();
  for (const path of code) {
    const text = file(path) ?? "";
    for (const line of text.split("\n")) {
      if (line.includes("DOCTYPE")) continue; // a format identifier, never fetched
      for (const m of line.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
        const host = (m[1] ?? "").toLowerCase();
        if (!NOT_CONTACTED.test(host) && !hosts.some((h) => h.host === host)) {
          hosts.push({ host, path });
        }
      }
    }
    for (const m of text.matchAll(/agent:\s*"([a-z][a-z0-9_-]*)",\s*systemPrompt/g)) {
      agents.add(m[1] ?? "");
    }
  }

  const index = buildRepoIndex(root);
  const docs = tracked
    .filter((p) => /^docs\/(conformite|securite)\/.+\.md$/.test(p))
    .map((path) => ({ path, text: must(path) }));
  return {
    register: must("docs/conformite/registre-traitements.md"),
    registerIa: must("docs/conformite/registre-ia.md"),
    secretsDoc: must("docs/securite/secrets.md"),
    cadres,
    tempoRetentionHours: [
      ...(file("deploy/observability/tempo.yaml") ?? "").matchAll(/block_retention:\s*(\d+)h/g),
    ].map((m) => Number(m[1])),
    tables: [
      ...new Set(
        tracked
          .filter((p) => /^packages\/journal\/sql\/.+\.sql$/.test(p))
          .flatMap((p) =>
            [...must(p).matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/g)].map((m) => m[1] ?? ""),
          ),
      ),
    ].sort(),
    file,
    hosts,
    agents: [...agents].sort(),
    secretFiles: Object.values(SECRET_FAMILIES).map((f) => f.file),
    adrs: new Set(
      tracked.flatMap((p) => {
        const m = /^docs\/adr\/(\d{4})-/.exec(p);
        return m?.[1] === undefined ? [] : [m[1]];
      }),
    ),
    // ADRs, npm scripts and paths of the repository's folders: a model id
    // (`qwen/…`) is no path, and a denied path is cited as such, on purpose.
    missingReferences: (_path, text) =>
      verifyClaims(
        extractClaims(text).filter(
          (c) =>
            c.kind === "adr" ||
            c.kind === "script" ||
            (c.kind === "path" && REPO_PATH.test(c.value) && !DENIED.test(c.value)),
        ),
        index,
      )
        .filter((c) => !c.found)
        .map((c) =>
          c.claim.kind === "adr"
            ? `ADR-${c.claim.value}`
            : c.claim.kind === "script"
              ? `npm run ${c.claim.value}`
              : c.claim.value,
        ),
    docs,
  };
}
