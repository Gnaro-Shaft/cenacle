/**
 * Extracts the sender's domain from a raw `From:` header — and nothing else.
 *
 * The header is attacker-controlled (charter: never trust a received
 * reference), so the parser is strict: anything ambiguous gives null
 * ("unknown"), never a guess and never an exception.
 */

const MAX_HEADER_LENGTH = 2048;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const LOCAL_PART = /^[^\s@<>()",;:\\[\]]+$/;

/** Removes "quoted strings" and (comments), which may contain fake addresses. */
function stripQuotedAndComments(value: string): string | null {
  let out = "";
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const chr = value[i];
    if (chr === "\\" && (quoted || depth > 0)) {
      i++; // escaped character inside a quote or comment: skip it
      continue;
    }
    if (quoted) {
      if (chr === '"') quoted = false;
      continue;
    }
    if (chr === "(") depth++;
    else if (chr === ")") {
      if (depth === 0) return null;
      depth--;
    } else if (depth === 0) {
      if (chr === '"') quoted = true;
      else out += chr;
    }
  }
  return quoted || depth > 0 ? null : out;
}

function validDomain(domain: string): boolean {
  if (domain.length > 253) return false;
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) => LABEL.test(label));
}

interface Mailbox {
  readonly address: string;
  readonly domain: string;
}

function unfoldHeader(raw: string | null | undefined, name: string): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_HEADER_LENGTH) return null;
  const unfolded = raw.replace(/\r?\n[ \t]+/g, " ").trim();
  if (/[\r\n]/.test(unfolded)) return null; // several header lines: not a single header
  return unfolded.replace(new RegExp(`^${name}:\\s*`, "i"), "");
}

/** One mailbox, already stripped of quotes and comments: `a@b.c` or `Name <a@b.c>`. */
function parseMailbox(plain: string): Mailbox | null {
  const opens = plain.split("<").length - 1;
  const closes = plain.split(">").length - 1;
  let address: string;
  if (opens === 0 && closes === 0) address = plain.trim();
  else if (opens === 1 && closes === 1) {
    const match = /<([^<>]*)>\s*$/.exec(plain);
    if (match?.[1] === undefined) return null;
    address = match[1].trim();
  } else return null;

  const at = address.indexOf("@");
  if (at <= 0 || at !== address.lastIndexOf("@")) return null;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1).toLowerCase();
  if (!LOCAL_PART.test(local) || !validDomain(domain)) return null;
  // Local parts are case-insensitive in practice: one address, one spelling.
  return { address: `${local.toLowerCase()}@${domain}`, domain };
}

function singleSender(raw: string | null | undefined): Mailbox | null {
  const value = unfoldHeader(raw, "from");
  if (value === null) return null;
  const plain = stripQuotedAndComments(value);
  if (plain === null) return null;
  if (plain.includes(",") || plain.includes(";")) return null; // several senders or a group
  return parseMailbox(plain);
}

/**
 * `raw` is the header as fetched: `From: ...` or just its value, possibly folded.
 * Returns the lowercased domain, or null if it cannot be read unambiguously.
 */
export function senderDomain(raw: string | null | undefined): string | null {
  return singleSender(raw)?.domain ?? null;
}

/** The sender's lowercased address, or null — same strict reading as senderDomain. */
export function senderAddress(raw: string | null | undefined): string | null {
  return singleSender(raw)?.address ?? null;
}

/**
 * Every readable address of a To/Cc header (`To: a@x, "B, C" <b@y>`).
 * Unreadable entries are left out; groups and broken headers give [].
 */
export function addressList(raw: string | null | undefined, name: string): string[] {
  const value = unfoldHeader(raw, name);
  if (value === null) return [];
  const plain = stripQuotedAndComments(value);
  if (plain === null || plain.includes(";") || plain.includes(":")) return [];
  const addresses = new Set<string>();
  for (const part of plain.split(",")) {
    const mailbox = parseMailbox(part);
    if (mailbox !== null) addresses.add(mailbox.address);
    if (addresses.size >= 50) break;
  }
  return [...addresses];
}
