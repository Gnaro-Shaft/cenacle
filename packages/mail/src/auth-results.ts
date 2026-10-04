/**
 * Reads one Authentication-Results header (RFC 8601) — and trusts none of it.
 *
 *   authserv-id [version] ; method=result ptype.property=value ... ; ...
 *   authserv-id ; none
 *
 * Anyone can write this header in the mail they send: which ones to believe
 * (the server that added it, and where it sits) is decided by the caller.
 * Anything this parser cannot read without guessing gives null.
 */

export const MAX_AUTH_RESULTS_LENGTH = 8192;
export const MAX_RESULTS = 50;

export interface MethodResult {
  /** Lowercased: "dmarc", "dkim", "spf"… */
  readonly method: string;
  /** Lowercased: "pass", "fail"… */
  readonly result: string;
  /** "header.from", "header.d", "smtp.mailfrom"… → lowercased, unquoted value. */
  readonly props: Readonly<Record<string, string>>;
}

export interface AuthResults {
  /** Lowercased name of the server that says it added the header. */
  readonly authservId: string;
  readonly results: readonly MethodResult[];
}

/** Removes (comments); "quoted strings" are kept as they are. */
function stripComments(value: string): string | null {
  let out = "";
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const chr = value[i];
    if (chr === "\\" && (quoted || depth > 0)) {
      if (quoted) out += value.slice(i, i + 2);
      i++;
      continue;
    }
    if (quoted) {
      out += chr;
      if (chr === '"') quoted = false;
    } else if (chr === "(") depth++;
    else if (chr === ")") {
      if (depth === 0) return null;
      depth--;
    } else if (depth === 0) {
      if (chr === '"') quoted = true;
      out += chr;
    }
  }
  return quoted || depth > 0 ? null : out;
}

/** Splits on ";" outside quoted strings. */
function splitResinfo(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const chr = value[i];
    if (chr === "\\" && quoted) {
      current += value.slice(i, i + 2);
      i++;
    } else if (chr === '"') {
      quoted = !quoted;
      current += chr;
    } else if (chr === ";" && !quoted) {
      parts.push(current);
      current = "";
    } else current += chr;
  }
  parts.push(current);
  return parts;
}

const TOKEN = /[^\s"=]+=(?:"(?:[^"\\]|\\.)*"|[^\s"]*)|\S+/g;
const AUTHSERV_ID = /^[a-z0-9](?:[a-z0-9._-]{0,251}[a-z0-9])?$/;
const METHOD = /^([a-z0-9][a-z0-9-]{0,63})(?:\/\d{1,3})?=([a-z]{1,16})$/;
const PROP = /^([a-z0-9-]{1,16}\.[a-z0-9._-]{1,64})=(.*)$/;

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"') && value.length >= 2
    ? value.slice(1, -1).replace(/\\(.)/g, "$1")
    : value;
}

function readResult(part: string): MethodResult | null {
  const tokens = part.trim().toLowerCase().match(TOKEN) ?? [];
  const head = METHOD.exec(tokens[0] ?? "");
  if (head?.[1] === undefined || head[2] === undefined) return null;
  const props: Record<string, string> = {};
  for (const token of tokens.slice(1)) {
    if (token.startsWith("reason=")) continue; // free text, never evidence
    const prop = PROP.exec(token);
    if (prop?.[1] === undefined || prop[2] === undefined) return null;
    if (Object.hasOwn(props, prop[1])) return null; // said twice: ambiguous
    props[prop[1]] = unquote(prop[2]);
  }
  return { method: head[1], result: head[2], props };
}

export function parseAuthResults(value: string): AuthResults | null {
  if (value.length === 0 || value.length > MAX_AUTH_RESULTS_LENGTH) return null;
  const plain = stripComments(value);
  if (plain === null) return null;
  const [first = "", ...rest] = splitResinfo(plain);
  const id = first.trim().toLowerCase().split(/\s+/);
  const authservId = id[0] ?? "";
  if (!AUTHSERV_ID.test(authservId)) return null;
  if (id.length > 2 || (id.length === 2 && !/^\d{1,3}$/.test(id[1] ?? ""))) return null;

  const parts = rest.map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return null; // nothing after the id: not even "none"
  if (parts.length === 1 && parts[0]?.toLowerCase() === "none") return { authservId, results: [] };
  if (parts.length > MAX_RESULTS) return null;
  const results: MethodResult[] = [];
  for (const part of parts) {
    const result = readResult(part);
    if (result === null) return null;
    results.push(result);
  }
  return { authservId, results };
}
