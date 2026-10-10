/**
 * Reads the veille's feeds (RSS and Atom), without a parser library: the
 * fields needed are few, and a feed is untrusted text. Each item keeps a
 * title, a link (http or https only), a date and a short description; an item
 * outside the window, without a title or a valid link, is left out. A feed
 * that fails is named, never fatal; its error's text is never kept.
 */
import type { Source } from "./sources.ts";

export interface FeedItem {
  readonly source: string;
  readonly theme: Source["theme"];
  readonly title: string;
  readonly link: string;
  readonly publishedAt: number;
  readonly description: string;
}

export interface FeedRead {
  readonly items: readonly FeedItem[];
  /** The names of the sources that could not be read. */
  readonly failed: readonly string[];
}

const MAX_FEED_BYTES = 3_000_000;
const MAX_ITEMS_PER_FEED = 60;
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 300;

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decode(s: string): string {
  return s
    .replace(/&(lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d{1,6});/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, n) =>
      String.fromCodePoint(Math.min(Number.parseInt(n, 16), 0x10ffff)),
    )
    .replace(/&amp;/g, "&");
}

const cdata = (s: string) => s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
/** Text without tags nor runs of blanks. */
const plain = (s: string) =>
  decode(cdata(s))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function field(body: string, tag: string): string {
  const m = body.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return m?.[1] ?? "";
}

function linkOf(body: string, atom: boolean): string | null {
  let raw: string;
  if (atom) {
    const alternate =
      body.match(/<link\b(?=[^>]*\brel=["']alternate["'])[^>]*\bhref=["']([^"']+)["']/i) ??
      body.match(/<link\b(?![^>]*\brel=)[^>]*\bhref=["']([^"']+)["']/i) ??
      body.match(/<link\b[^>]*\bhref=["']([^"']+)["']/i);
    raw = alternate?.[1] ?? "";
  } else {
    raw = field(body, "link");
  }
  return normalizeLink(decode(cdata(raw)).trim());
}

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|ref_src)$/i;

/**
 * One article, one link: no fragment, no tracking parameters, no trailing
 * slash — what the archive compares to never send an article twice. Null
 * for anything but http(s).
 */
export function normalizeLink(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING.test(key)) url.searchParams.delete(key);
  }
  const out = url.toString();
  return url.pathname !== "/" && out.endsWith("/") ? out.slice(0, -1) : out;
}

/** The items of one feed published within `windowMs` before `now`. */
export function parseFeed(xml: string, source: Source, now: number, windowMs: number): FeedItem[] {
  const rss = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  const entries = [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)];
  const atom = rss.length === 0 && entries.length > 0;
  const items: FeedItem[] = [];
  for (const m of (atom ? entries : rss).slice(0, MAX_ITEMS_PER_FEED)) {
    const body = m[1] ?? "";
    const title = plain(field(body, "title")).slice(0, TITLE_MAX);
    const link = linkOf(body, atom);
    const dated =
      field(body, "pubDate") ||
      field(body, "published") ||
      field(body, "updated") ||
      field(body, "dc:date");
    const publishedAt = Date.parse(plain(dated));
    // No date, or a date in the future: not provably fresh — left out.
    if (title === "" || link === null || Number.isNaN(publishedAt)) continue;
    if (publishedAt > now + 3_600_000 || publishedAt < now - windowMs) continue;
    const description = plain(
      field(body, "description") || field(body, "summary") || field(body, "content"),
    ).slice(0, DESCRIPTION_MAX);
    items.push({ source: source.nom, theme: source.theme, title, link, publishedAt, description });
  }
  return items;
}

export interface FetchDeps {
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly timeoutMs?: number;
}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_FEED_BYTES) {
      await reader.cancel();
      throw new Error("feed too large");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Reads every source at once; one failure never stops the others. */
export async function readFeeds(
  sources: readonly Source[],
  windowHours: number,
  deps: FetchDeps,
): Promise<FeedRead> {
  const now = deps.now();
  const results = await Promise.all(
    sources.map(async (source) => {
      try {
        const response = await deps.fetch(source.url, {
          headers: { "user-agent": "cenacle-veille/1.0", accept: "application/rss+xml, */*" },
          redirect: "follow",
          signal: AbortSignal.timeout(deps.timeoutMs ?? 20_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const xml = await readCapped(response);
        return { source, items: parseFeed(xml, source, now, windowHours * 3_600_000) };
      } catch {
        return { source, items: null };
      }
    }),
  );
  const seen = new Set<string>();
  const items: FeedItem[] = [];
  for (const r of results) {
    for (const item of r.items ?? []) {
      if (seen.has(item.link)) continue;
      seen.add(item.link);
      items.push(item);
    }
  }
  items.sort((a, b) => b.publishedAt - a.publishedAt);
  return { items, failed: results.filter((r) => r.items === null).map((r) => r.source.nom) };
}
