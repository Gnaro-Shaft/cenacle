// The veille's archive (J5, ADR-0024), in the real database: a link is
// archived once; sent links and recent titles come back; the purge takes only
// what is older than the cutoff; a search finds by project and by words,
// never treating % or _ as wildcards; the app role cannot change an entry;
// and the table refuses what does not hold.
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { appConnection } from "./test-db.ts";
import { createVeilleStore, type NewArchivedArticle } from "./veille-store.ts";

const sql = appConnection();
afterAll(async () => {
  await sql.end();
});
const store = createVeilleStore(sql);
const run = randomBytes(4).toString("hex");
const article = (n: number, over: Partial<NewArchivedArticle> = {}): NewArchivedArticle => ({
  link: `https://veille.example/${run}/${n}`,
  source: "Flux",
  theme: "actualite",
  title: `Titre ${run} ${n}`,
  publishedAt: "2026-10-10T05:00:00.000Z",
  score: 8,
  resume: `Résumé ${n}`,
  project: "Atelier",
  idea: "Essayer.",
  ...over,
});

describe("the veille's archive", () => {
  it("a link is archived once; sent links come back, the others not", async () => {
    expect(await store.record([article(1), article(2), article(1)])).toBe(2);
    const sent = await store.sentLinks([article(1).link, article(3).link]);
    expect([...sent]).toEqual([article(1).link]);
    expect(await store.sentLinks([])).toEqual(new Set());
  });

  it("recent titles: since the date, newest first, at most the limit", async () => {
    await store.record([article(10), article(11)]);
    const titles = await store.recentTitles(new Date(Date.now() - 60_000), 500);
    expect(titles).toContain(article(10).title);
    expect(await store.recentTitles(new Date(Date.now() + 60_000), 10)).toEqual([]);
    expect((await store.recentTitles(new Date(0), 1)).length).toBe(1);
  });

  it("search: by project (any case) and by words; % and _ are words, not wildcards", async () => {
    await store.record([
      article(20, { project: "Boussole", title: `RAG ${run} 100% local` }),
      article(21, { project: "Boussole", title: `RAG ${run} quarante` }),
    ]);
    const byProject = await store.search({ project: "boussole", text: run });
    expect(byProject.map((a) => a.title).sort()).toEqual(
      [`RAG ${run} 100% local`, `RAG ${run} quarante`].sort(),
    );
    const percent = await store.search({ text: `${run} 100%` });
    expect(percent.map((a) => a.title)).toEqual([`RAG ${run} 100% local`]);
    expect(await store.search({ text: `${run}_%` })).toEqual([]);
    expect((await store.search({ text: run, limit: 1 })).length).toBe(1);
  });

  it("the purge takes only what was sent before the cutoff", async () => {
    await store.record([article(30)]);
    expect(await store.purge(new Date(Date.now() - 3_600_000))).toBeGreaterThanOrEqual(0);
    expect((await store.sentLinks([article(30).link])).size).toBe(1);
    await store.purge(new Date(Date.now() + 60_000));
    expect((await store.sentLinks([article(30).link, article(1).link])).size).toBe(0);
  });

  it("the app role cannot change an entry", async () => {
    await store.record([article(40)]);
    await expect(
      sql`update veille_articles set score = 1 where link = ${article(40).link}`,
    ).rejects.toThrow(/permission denied/);
  });

  it.each([
    ["a score out of 1-10", { score: 11 }],
    ["an unknown theme", { theme: "potins" as never }],
    ["an empty title", { title: "" }],
    ["a summary too long", { resume: "r".repeat(401) }],
  ])("refuses %s", async (_, over) => {
    await expect(
      store.record([article(50 + Math.floor(Math.random() * 1e6), over)]),
    ).rejects.toThrow();
  });
});
