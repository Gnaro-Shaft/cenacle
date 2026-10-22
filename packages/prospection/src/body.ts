/**
 * An alert's text for the model (ADR-0032, point 6): plain text, each link
 * replaced by a numbered marker ([L3]) whose address only the code keeps.
 * The model answers with a number; it never writes an address. Iris's own
 * conversion throws link targets away, so this one is its own.
 */
import PostalMime from "postal-mime";

export interface MailBody {
  /** Plain text, markers in place of links, capped. */
  readonly text: string;
  /** links[n - 1] is the address of marker [Ln]: https only, as written in the mail. */
  readonly links: readonly string[];
  /** True when the text was longer than the cap: the rest is lost, and counted. */
  readonly cut: boolean;
}

/** Markers at most: a mail with more links keeps the first ones. */
export const MAX_LINKS = 300;

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith("#")) {
      const n =
        code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isInteger(n) && n > 31 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

class Links {
  readonly list: string[] = [];
  private readonly index = new Map<string, number>();

  /** The marker for an https address, or "" for anything else (javascript:, mailto:, http:). */
  marker(raw: string): string {
    const address = decodeEntities(raw).trim();
    if (!/^https:\/\/[^\s"'<>]+$/i.test(address)) return "";
    let n = this.index.get(address);
    if (n === undefined) {
      if (this.list.length >= MAX_LINKS) return "";
      this.list.push(address);
      n = this.list.length;
      this.index.set(address, n);
    }
    return ` [L${n}] `;
  }
}

function fromHtml(html: string, links: Links): string {
  const withoutBlocks = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head|template)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(script|style|head|template)\b[\s\S]*$/gi, " ");
  const withLinks = withoutBlocks.replace(
    /<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi,
    (_whole, _q, dq?: string, sq?: string, bare?: string, inner = "") =>
      `${inner}${links.marker(dq ?? sq ?? bare ?? "")}`,
  );
  const withBreaks = withLinks.replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, "\n");
  return decodeEntities(withBreaks.replace(/<[^>]*>?/g, " "));
}

function fromText(text: string, links: Links): string {
  return text.replace(/https?:\/\/[^\s<>"')\]]+/gi, (address) => links.marker(address) || " ");
}

/** Same cleaning as the model's other inputs: no control or invisible character, blanks collapsed. */
function tidy(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (c) => (c === "\n" ? "\n" : " "))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n[\n ]*/g, "\n")
    .trim();
}

export function bodyOfParts(
  parts: { readonly html?: string | undefined; readonly text?: string | undefined },
  max: number,
): MailBody {
  const links = new Links();
  const raw =
    parts.html !== undefined && parts.html.trim() !== ""
      ? fromHtml(parts.html, links)
      : fromText(parts.text ?? "", links);
  const text = tidy(raw);
  const cut = text.length > max;
  // A marker cut in half would point nowhere: the cut never splits one.
  const kept = cut ? text.slice(0, max).replace(/\s*\[L\d*$/, "") : text;
  return { text: kept, links: links.list, cut };
}

/** From a raw source. A source that cannot be parsed gives an empty body (counted by the caller). */
export async function bodyOf(source: Buffer, max: number): Promise<MailBody> {
  try {
    const email = await PostalMime.parse(source, { maxNestingDepth: 20 });
    return bodyOfParts({ html: email.html, text: email.text }, max);
  } catch {
    return { text: "", links: [], cut: false };
  }
}
