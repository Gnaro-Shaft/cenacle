// Never twice the same news (J5): a link already sent is left out by code,
// even with a fragment or tracking parameters; the same news under another
// link, by the model, told the titles of the last week (between markers);
// only what the message showed is archived; a message that failed to leave
// archives nothing; the archive is purged after `veille_jours`; and the
// archive comes back as Markdown that says it is AI-generated.
import type { ArchivedArticle, NewEvent } from "@cenacle/journal";
import { describe, expect, it } from "vitest";
import { ARCHIVE_NOTICE, archiveMarkdown } from "./archive-format.ts";
import { type FeedItem, normalizeLink } from "./feeds.ts";
import { runVeille, type VeilleMemory } from "./run.ts";
import { buildVeillePrompt, parseScores } from "./score.ts";
import type { VeilleConfig } from "./sources.ts";

const NOW = new Date("2026-10-11T06:00:00Z");
const DAY = 24 * 3_600_000;
const art = (i: number, link = `https://news.example/${i}`): FeedItem => ({
  source: "Flux",
  theme: "actualite",
  title: `Article ${i}`,
  link,
  publishedAt: NOW.getTime() - i * 60_000,
  description: "",
});
const config = (maxRetenus = 12): VeilleConfig => ({
  settings: {
    fenetreHeures: 30,
    maxArticles: 50,
    maxParSource: 8,
    seuil: 7,
    maxRetenus,
    veilleJours: 365,
    profil: "moi",
  },
  sources: [],
  projects: [{ nom: "Atelier", resume: "r", pile: ["TS"] }],
  exampleProjects: false,
});

function world(options: {
  items: FeedItem[];
  sent?: string[];
  recent?: string[];
  answer: (prompt: string) => string;
  sendFails?: boolean;
  maxRetenus?: number;
}) {
  const archived: string[] = [];
  const purged: Date[] = [];
  const prompts: string[] = [];
  const events: NewEvent[] = [];
  const messages: string[] = [];
  const memory: VeilleMemory = {
    sentLinks: async (links) => new Set(links.filter((l) => (options.sent ?? []).includes(l))),
    recentTitles: async () => options.recent ?? [],
    record: async (a) => {
      archived.push(...a.map((x) => x.link));
      return a.length;
    },
    purge: async (cutoff) => {
      purged.push(cutoff);
      return 0;
    },
  };
  const deps = {
    config: config(options.maxRetenus),
    read: async () => ({ items: options.items, failed: [] }),
    ask: async (prompt: string) => {
      prompts.push(prompt);
      return options.answer(prompt);
    },
    send: async (text: string) => {
      if (options.sendFails === true) throw new Error("Telegram unreachable");
      messages.push(text);
    },
    memory,
    journal: {
      append: async (e: NewEvent) => {
        events.push(e);
        return { id: 1n, occurredAt: NOW, agent: e.agent, type: e.type, payload: e.payload ?? {} };
      },
      read: async () => [],
    },
    now: () => NOW,
    sleep: async () => {},
    nonce: () => "n0",
  };
  return { deps, archived, purged, prompts, events, messages };
}
const keepAll = (n: number) => () =>
  JSON.stringify(Array.from({ length: n }, (_, i) => ({ i: i + 1, note: 8, resume: "R." })));

describe("normalizeLink", () => {
  it("one article, one link: no fragment, no tracking, no trailing slash", () => {
    const base = "https://news.example/a/b";
    for (const variant of [
      `${base}#top`,
      `${base}?utm_source=x&utm_medium=y`,
      `${base}/`,
      `${base}/?fbclid=1#c`,
    ]) {
      expect(normalizeLink(variant)).toBe(base);
    }
    expect(normalizeLink("https://news.example/a?id=3&utm_campaign=z")).toBe(
      "https://news.example/a?id=3",
    );
    expect(normalizeLink("javascript:alert(1)")).toBeNull();
    expect(normalizeLink("not a link")).toBeNull();
  });
});

describe("never twice the same news", () => {
  it("a link already sent is left out before the model even sees it", async () => {
    const w = world({
      items: [art(1), art(2)],
      sent: ["https://news.example/1"],
      answer: keepAll(1),
    });
    const out = await runVeille(w.deps);
    expect(w.prompts[0]).not.toContain("Article 1");
    expect(w.messages[0]).not.toContain("news.example/1\n");
    expect(out).toMatchObject({ kind: "sent", repeated: 1 });
  });

  it("the titles of the last week go to the model between markers; what it marks again is dropped", async () => {
    const w = world({
      items: [art(1), art(2)],
      recent: ["LangGraph 1.0 est sorti"],
      answer: () =>
        '[{"i": 1, "note": 9, "resume": "Encore.", "deja": true}, {"i": 2, "note": 8, "resume": "Neuf."}]',
    });
    const out = await runVeille(w.deps);
    const p = w.prompts[0] ?? "";
    const open = p.indexOf("<<<DEJA ENVOYES n0>>>");
    expect(open).toBeGreaterThan(-1);
    expect(p.indexOf("LangGraph 1.0 est sorti")).toBeGreaterThan(open);
    expect(p.indexOf("<<<FIN DEJA ENVOYES n0>>>")).toBeGreaterThan(p.indexOf("LangGraph 1.0"));
    expect(w.messages[0]).not.toContain("Article 1");
    expect(w.messages[0]).toContain("Article 2");
    expect(w.archived).toEqual(["https://news.example/2"]);
    expect(out).toMatchObject({ repeated: 1, kept: 1 });
  });

  it("no history: no 'already sent' section at all", () => {
    expect(buildVeillePrompt([art(1)], [], "moi", 7, "n0", [])).not.toContain("DEJA");
  });

  it("'deja' is read only when strictly true", () => {
    const got = parseScores('[{"i":1,"note":8,"deja":"true"},{"i":2,"note":8,"deja":1}]', 2, [], 7);
    expect(got.every((s) => !s.duplicate)).toBe(true);
  });
});

describe("the archive", () => {
  it("only what the message showed is archived; the left-out may come back", async () => {
    const big = (i: number) => ({ ...art(i), title: `Article ${i} ${"t".repeat(190)}` });
    const items = Array.from({ length: 12 }, (_, i) => big(i + 1));
    const w = world({
      items,
      answer: () =>
        JSON.stringify(items.map((_, i) => ({ i: i + 1, note: 8, resume: "r".repeat(390) }))),
    });
    const out = await runVeille(w.deps);
    expect(w.messages[0]).toMatch(/autre\(s\) retenu/);
    expect(w.archived.length).toBeGreaterThan(0);
    // Fewer archived than kept: the ones without room in the message are not.
    expect(w.archived.length).toBeLessThan(out.kind === "sent" ? out.kept : 0);
    // At most 8 per source reach the model (max_par_source).
    expect(out).toMatchObject({ kept: 8, archived: w.archived.length });
  });

  it("a message that failed to leave archives nothing and purges nothing", async () => {
    const w = world({ items: [art(1)], answer: keepAll(1), sendFails: true });
    await expect(runVeille(w.deps)).rejects.toThrow(/Telegram/);
    expect(w.archived).toEqual([]);
    expect(w.purged).toEqual([]);
    expect(w.events).toEqual([]);
  });

  it("purged after veille_jours (365 days), at each veille", async () => {
    const w = world({ items: [art(1)], answer: keepAll(1) });
    await runVeille(w.deps);
    expect(w.purged.map((d) => d.toISOString())).toEqual([
      new Date(NOW.getTime() - 365 * DAY).toISOString(),
    ]);
  });
});

describe("archiveMarkdown", () => {
  const a = (over: Partial<ArchivedArticle> = {}): ArchivedArticle => ({
    sentAt: "2026-10-10T06:00:00.000Z",
    link: "https://news.example/x_(y)",
    source: "Flux",
    theme: "version",
    title: "Titre [piégé](https://evil.example)\nsur deux lignes",
    publishedAt: "2026-10-10T05:00:00.000Z",
    score: 8,
    resume: "Résumé.",
    project: "Atelier",
    idea: "Essayer.",
    ...over,
  });

  it("says it is AI-generated, and no feed text can break a line or a link", () => {
    const md = archiveMarkdown([a()], { project: "Atelier" });
    expect(md).toContain(ARCHIVE_NOTICE);
    expect(md).toContain("projet Atelier");
    const line = md.split("\n").find((l) => l.startsWith("- **[")) ?? "";
    expect(line).toContain("\\[piégé\\]");
    expect(line).toContain("(https://news.example/x_%28y%29)");
    expect(line).not.toContain("\n");
    expect(md).toContain("👉 Pour Atelier : Essayer.");
  });

  it("grouped by day; nothing found is said", () => {
    const md = archiveMarkdown([
      a(),
      a({ sentAt: "2026-10-09T06:00:00.000Z", link: "https://n.example/2" }),
    ]);
    expect(md.match(/^## /gm)).toHaveLength(2);
    expect(archiveMarkdown([])).toMatch(/Aucun article archivé/);
  });
});
