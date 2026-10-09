/**
 * What an answer of the CTO says exists (phase 6, J1 — ADR-0017): the ADRs,
 * files, commands and names it cites. Pure and bounded: a hostile or huge
 * answer yields at most MAX_CLAIMS claims, read in one linear pass.
 */

export type ClaimKind = "adr" | "path" | "line" | "script" | "name";

export interface Claim {
  readonly kind: ClaimKind;
  readonly value: string;
}

export const MAX_CLAIMS = 60;
/** An answer longer than this is cut before extraction: the rest is not checked. */
export const MAX_ANSWER = 40_000;

const FILE_EXT = /\.(ts|tsx|js|mjs|md|toml|sql|json|ya?ml|sh|css|html)$/;
const PRIVATE = /(^|\/)\.env|\.local\.toml$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_.:-]{2,79}$/;

function classify(raw: string): Claim | null {
  const span = raw.trim();
  const script = /^npm run ([a-z][a-z0-9:_-]{0,40})\b/.exec(span);
  if (script?.[1] !== undefined) return { kind: "script", value: script[1] };
  if (/\s/.test(span)) return null; // a code snippet, not a name
  // A chat command such as `/stop` or `/cto`: a name to look up, not an absolute path.
  if (/^\/[a-z]{2,20}$/.test(span)) return { kind: "name", value: span };
  const bare = span.replace(/\(\)$/, "").replace(/^\[(.+)\]$/, "$1");
  // "path:12" or "path:12-30": a place in the code (ADR-0021).
  const place = /^([\w./@-]{2,200}\.[a-z]{1,5}):(\d{1,6})(?:-(\d{1,6}))?$/.exec(bare);
  if (place?.[1] !== undefined && !PRIVATE.test(place[1])) {
    return {
      kind: "line",
      value: `${place[1].replace(/^\.\//, "")}:${place[2]}${place[3] === undefined ? "" : `-${place[3]}`}`,
    };
  }
  // A private file is never a path to look up: only its name, in versioned text.
  if (PRIVATE.test(bare)) return { kind: "name", value: bare };
  if ((bare.includes("/") || FILE_EXT.test(bare)) && /^[\w./@-]{2,200}$/.test(bare)) {
    return { kind: "path", value: bare.replace(/^\.\//, "") };
  }
  if (/^\d[\d\-:./]*$/.test(bare)) return null; // a number, a date
  return IDENT.test(bare) ? { kind: "name", value: bare } : null;
}

export function extractClaims(answer: string): Claim[] {
  const text = answer.slice(0, MAX_ANSWER);
  const found = new Map<string, Claim>();
  const add = (c: Claim | null) => {
    if (c !== null && found.size < MAX_CLAIMS) found.set(`${c.kind}:${c.value}`, c);
  };
  for (const m of text.matchAll(/\bADR[-‑ ]?(\d{4})\b/g)) add({ kind: "adr", value: m[1] ?? "" });
  for (const m of text.matchAll(/`([^`\n]{1,200})`/g)) add(classify(m[1] ?? ""));
  for (const m of text.matchAll(/\bnpm run ([a-z][a-z0-9:_-]{0,40})/g))
    add({ kind: "script", value: m[1] ?? "" });
  for (const m of text.matchAll(
    /(?<![\w/.])((?:docs|apps|packages|deploy)\/[\w./-]{1,200}\.[a-z]{1,5})\b(?::(\d{1,6})(?:-(\d{1,6}))?)?/g,
  )) {
    add({ kind: "path", value: m[1] ?? "" });
    if (m[2] !== undefined) {
      add({ kind: "line", value: `${m[1]}:${m[2]}${m[3] === undefined ? "" : `-${m[3]}`}` });
    }
  }
  return [...found.values()];
}
