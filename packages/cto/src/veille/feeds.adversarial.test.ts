// The veille reads untrusted feeds: RSS and Atom, CDATA and entities; a link
// that is not http(s), an item without a date or dated in the future, or
// outside the window, is left out; a feed too large or failing is named,
// never fatal, its error never kept; a busy source cannot crowd out the
// others; and the configuration refuses what it should.
import { describe, expect, it } from "vitest";
import { parseFeed, readFeeds } from "./feeds.ts";
import { selectItems } from "./run.ts";
import { parseProjects, parseSources, VeilleConfigError } from "./sources.ts";

const NOW = Date.parse("2026-10-10T08:00:00Z");
const H = 3_600_000;
const SRC = { nom: "Flux", url: "https://feed.example/rss", theme: "actualite" as const };
const rss = (items: string) => `<?xml version="1.0"?><rss><channel>${items}</channel></rss>`;
const item = (title: string, link: string, date: string, extra = "") =>
  `<item><title>${title}</title><link>${link}</link><pubDate>${date}</pubDate>${extra}</item>`;
const hoursAgo = (h: number) => new Date(NOW - h * H).toUTCString();

describe("parseFeed", () => {
  it("RSS with CDATA, entities and tags: plain text out", () => {
    const xml = rss(
      item(
        "<![CDATA[LangGraph <b>1.0</b> &amp; plus]]>",
        "https://a.example/1",
        hoursAgo(2),
        "<description>&lt;p&gt;Une   nouvelle&lt;/p&gt; version &#233;tonnante</description>",
      ),
    );
    const [it1] = parseFeed(xml, SRC, NOW, 30 * H);
    expect(it1?.title).toBe("LangGraph 1.0 & plus");
    expect(it1?.description).toBe("Une nouvelle version étonnante");
  });

  it("Atom: the alternate link, the published date", () => {
    const xml = `<feed><entry><title>v2.3.0</title><link rel="self" href="https://x.example/self"/><link rel="alternate" href="https://github.com/o/r/releases/tag/v2.3.0"/><updated>${new Date(NOW - H).toISOString()}</updated><content type="html">Notes</content></entry></feed>`;
    const [e] = parseFeed(xml, SRC, NOW, 30 * H);
    expect(e?.link).toBe("https://github.com/o/r/releases/tag/v2.3.0");
    expect(e?.description).toBe("Notes");
  });

  it("left out: a javascript: or data: link, no title, no date, a future date, too old", () => {
    const xml = rss(
      [
        item("ok", "https://a.example/ok", hoursAgo(1)),
        item("js", "javascript:alert(1)", hoursAgo(1)),
        item("data", "data:text/html,x", hoursAgo(1)),
        item("", "https://a.example/notitle", hoursAgo(1)),
        "<item><title>nodate</title><link>https://a.example/nodate</link></item>",
        item("future", "https://a.example/future", new Date(NOW + 48 * H).toUTCString()),
        item("old", "https://a.example/old", hoursAgo(31)),
      ].join(""),
    );
    expect(parseFeed(xml, SRC, NOW, 30 * H).map((i) => i.title)).toEqual(["ok"]);
  });

  it("long titles and descriptions are capped; at most 60 items are read per feed", () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      item(
        `t${i}${"x".repeat(500)}`,
        `https://a.example/${i}`,
        hoursAgo(1),
        `<description>${"d".repeat(2000)}</description>`,
      ),
    ).join("");
    const items = parseFeed(rss(many), SRC, NOW, 30 * H);
    expect(items).toHaveLength(60);
    expect(items[0]?.title.length).toBeLessThanOrEqual(200);
    expect(items[0]?.description.length).toBeLessThanOrEqual(300);
  });

  it("garbage in: no item, no crash", () => {
    expect(parseFeed("<html>not a feed", SRC, NOW, 30 * H)).toEqual([]);
    expect(parseFeed("", SRC, NOW, 30 * H)).toEqual([]);
  });
});

describe("readFeeds", () => {
  const ok = (body: string) => new Response(body, { status: 200 });
  const B = { ...SRC, nom: "B", url: "https://b.example/rss" };
  const C = { ...SRC, nom: "C", url: "https://c.example/rss" };

  it("one source down, one in error, one too large: named, the others read; no error text", async () => {
    const huge = new ReadableStream({
      start(c) {
        for (let i = 0; i < 40; i++) c.enqueue(new TextEncoder().encode("x".repeat(100_000)));
        c.close();
      },
    });
    const fake = (async (url: string) => {
      if (url.includes("feed.example"))
        return ok(rss(item("ok", "https://a.example/1", hoursAgo(1))));
      if (url.includes("b.example"))
        throw new TypeError("getaddrinfo ENOTFOUND secret-host.internal");
      return new Response(huge, { status: 200 });
    }) as typeof fetch;
    const D = { ...SRC, nom: "D", url: "https://d.example/rss" };
    const read = await readFeeds([SRC, B, D], 30, { fetch: fake, now: () => NOW });
    expect(read.items.map((i) => i.title)).toEqual(["ok"]);
    expect(read.failed).toEqual(["B", "D"]);
    expect(JSON.stringify(read)).not.toMatch(/ENOTFOUND|secret-host/);
  });

  it("an HTTP error is a failed source", async () => {
    const fake = (async () => new Response("nope", { status: 429 })) as typeof fetch;
    const read = await readFeeds([C], 30, { fetch: fake, now: () => NOW });
    expect(read.failed).toEqual(["C"]);
  });

  it("the same link from two sources counts once (fragment ignored), newest first", async () => {
    const fake = (async (url: string) =>
      ok(
        rss(
          url.includes("feed.example")
            ? item("a", "https://same.example/x#top", hoursAgo(5)) +
                item("b", "https://b.example/y", hoursAgo(1))
            : item("a bis", "https://same.example/x", hoursAgo(3)),
        ),
      )) as typeof fetch;
    const read = await readFeeds([SRC, C], 30, { fetch: fake, now: () => NOW });
    expect(read.items.map((i) => i.title)).toEqual(["b", "a"]);
  });
});

describe("selectItems", () => {
  it("at most N per source, newest first, M in all", () => {
    const mk = (source: string, h: number) => ({
      source,
      theme: "actualite" as const,
      title: `${source}${h}`,
      link: `https://x.example/${source}${h}`,
      publishedAt: NOW - h * H,
      description: "",
    });
    const items = [
      ...Array.from({ length: 20 }, (_, i) => mk("arxiv", i)),
      mk("langgraph", 10),
      mk("hn", 12),
    ];
    const chosen = selectItems(items, 3, 5);
    expect(chosen.map((i) => i.title)).toEqual([
      "arxiv0",
      "arxiv1",
      "arxiv2",
      "langgraph10",
      "hn12",
    ]);
  });
});

describe("the configuration", () => {
  const head = `[reglage]\nfenetre_heures = 30\nmax_articles = 50\nmax_par_source = 8\nseuil = 7\nmax_retenus = 12\nveille_jours = 365\nprofil = "moi"\n`;
  const src = (url: string, nom = "A", theme = "actualite") =>
    `[[source]]\nnom = "${nom}"\nurl = "${url}"\ntheme = "${theme}"\n`;

  it("accepts a valid file", () => {
    expect(parseSources(head + src("https://a.example/rss")).sources).toHaveLength(1);
  });

  it.each([
    ["an http source (readable and alterable on its way)", head + src("http://a.example/rss")],
    ["a source that is not a URL", head + src("not a url")],
    ["an unknown theme", head + src("https://a.example/rss", "A", "potins")],
    ["a source named twice", head + src("https://a.example/1") + src("https://a.example/2")],
    ["no source", head],
    ["no [reglage]", src("https://a.example/rss")],
    [
      "a threshold out of 1-10",
      head.replace("seuil = 7", "seuil = 11") + src("https://a.example/rss"),
    ],
  ])("refuses %s", (_, text) => {
    expect(() => parseSources(text)).toThrow(VeilleConfigError);
  });

  it("projects: named once (any case), with a stack", () => {
    const p = (nom: string, pile = '["Python"]') =>
      `[[projet]]\nnom = "${nom}"\nresume = "r"\npile = ${pile}\n`;
    expect(parseProjects(p("Alpha") + p("Beta"))).toHaveLength(2);
    expect(() => parseProjects(p("Alpha") + p("alpha"))).toThrow(/twice/);
    expect(() => parseProjects(p("Alpha", "[]"))).toThrow(VeilleConfigError);
    expect(() => parseProjects("")).toThrow(VeilleConfigError);
  });
});
