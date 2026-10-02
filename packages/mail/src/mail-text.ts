/**
 * Turns a mail's text or HTML into the plain, bounded text the model reads.
 *
 * No HTML engine runs: tags are stripped as text, scripts and styles dropped
 * whole. Hidden text stays visible to the model on purpose — the model is
 * not trusted to ignore it, the closed output list is what limits harm.
 */
import { type MailForModel, MODEL_FIELD_MAX, MODEL_TEXT_MAX } from "@cenacle/core";

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n =
        code[1] === "x" || code[1] === "X"
          ? Number.parseInt(code.slice(2), 16)
          : Number(code.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

export function htmlToText(html: string): string {
  const withoutBlocks = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head|template)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(script|style|head|template)\b[\s\S]*$/gi, " "); // unclosed: drop the rest
  const withBreaks = withoutBlocks.replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, "\n");
  return decodeEntities(withBreaks.replace(/<[^>]*>?/g, " "));
}

/**
 * Control characters, zero-width and bidirectional marks, line/paragraph
 * separators and the BOM: invisible to a reader, sometimes used to hide text.
 * Tab (0x09) and newline (0x0A) are kept.
 */
function isInvisible(code: number): boolean {
  return (
    code <= 0x08 ||
    (code >= 0x0b && code <= 0x1f) ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff
  );
}

function withoutInvisible(text: string): string {
  let out = "";
  for (const char of text) out += isInvisible(char.codePointAt(0) ?? 0) ? " " : char;
  return out;
}

/** Removes control and invisible characters, collapses blanks, bounds the length. */
export function cleanForModel(text: string, max: number): string {
  const cleaned = withoutInvisible(text.normalize("NFC"))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n[\n ]*/g, "\n")
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

export interface MailParts {
  readonly uid: number;
  readonly fromName: string | undefined;
  readonly domain: string | null;
  readonly subject: string | undefined;
  readonly text: string | undefined;
  readonly html: string | undefined;
}

export function toMailForModel(parts: MailParts): MailForModel {
  const body = parts.text?.trim() ? parts.text : htmlToText(parts.html ?? "");
  return {
    uid: parts.uid,
    fromName: cleanForModel(parts.fromName ?? "", MODEL_FIELD_MAX).replace(/\n/g, " "),
    domain: parts.domain,
    subject: cleanForModel(parts.subject ?? "", MODEL_FIELD_MAX).replace(/\n/g, " "),
    text: cleanForModel(body, MODEL_TEXT_MAX),
  };
}
