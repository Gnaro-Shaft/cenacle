/**
 * The veille's archive (J5, ADR-0024): what was really sent to me, as I got
 * it. It keeps a sent article from coming back, and lets me reuse my veille
 * later. Public articles and the names of my projects — no personal data; the
 * score, summary and idea are AI-generated. Purged `veille_jours` after sending.
 */
import type { Sql } from "postgres";

export interface ArchivedArticle {
  readonly sentAt: string;
  readonly link: string;
  readonly source: string;
  readonly theme: "actualite" | "version";
  readonly title: string;
  readonly publishedAt: string;
  readonly score: number;
  readonly resume: string | null;
  readonly project: string | null;
  readonly idea: string | null;
}

export type NewArchivedArticle = Omit<ArchivedArticle, "sentAt">;

export interface ArchiveQuery {
  readonly since?: Date;
  /** One of my projects, by its exact name (any case). */
  readonly project?: string;
  /** Words found in the title, the summary or the idea (any case). */
  readonly text?: string;
  readonly limit?: number;
}

export interface VeilleStore {
  /** Which of these (normalized) links were already sent. */
  sentLinks(links: readonly string[]): Promise<ReadonlySet<string>>;
  /** Titles sent since then, newest first: the model is told not to say them again. */
  recentTitles(since: Date, limit: number): Promise<string[]>;
  /** Archives what was sent; a link already there is left as it is. Returns how many were added. */
  record(articles: readonly NewArchivedArticle[]): Promise<number>;
  /** Articles sent before the cutoff. Returns how many. */
  purge(cutoff: Date): Promise<number>;
  search(query: ArchiveQuery): Promise<ArchivedArticle[]>;
}

interface Row {
  sent_at: Date;
  link: string;
  source: string;
  theme: "actualite" | "version";
  title: string;
  published_at: Date;
  score: number;
  resume: string | null;
  project: string | null;
  idea: string | null;
}

/** A LIKE pattern matching the words as typed, never as wildcards. */
const like = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function createVeilleStore(sql: Sql): VeilleStore {
  return {
    async sentLinks(links) {
      if (links.length === 0) return new Set();
      const rows = await sql<{ link: string }[]>`
        select link from veille_articles where link = any(${[...links]}::text[])`;
      return new Set(rows.map((r) => r.link));
    },

    async recentTitles(since, limit) {
      const rows = await sql<{ title: string }[]>`
        select title from veille_articles where sent_at >= ${since}
        order by sent_at desc limit ${limit}`;
      return rows.map((r) => r.title);
    },

    async record(articles) {
      let added = 0;
      for (const a of articles) {
        const result = await sql`
          insert into veille_articles
            (link, source, theme, title, published_at, score, resume, project, idea)
          values (${a.link}, ${a.source}, ${a.theme}, ${a.title}, ${new Date(a.publishedAt)},
                  ${a.score}, ${a.resume}, ${a.project}, ${a.idea})
          on conflict (link) do nothing`;
        added += result.count;
      }
      return added;
    },

    async purge(cutoff) {
      const result = await sql`delete from veille_articles where sent_at < ${cutoff}`;
      return result.count;
    },

    async search(query) {
      const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
      const since = query.since ?? new Date(0);
      const project = query.project?.trim() ?? "";
      const text = query.text?.trim() ?? "";
      const rows = await sql<Row[]>`
        select sent_at, link, source, theme, title, published_at, score, resume, project, idea
        from veille_articles
        where sent_at >= ${since}
          and (${project} = '' or lower(project) = lower(${project}))
          and (${text} = '' or title ilike ${like(text)} or resume ilike ${like(text)}
               or idea ilike ${like(text)})
        order by sent_at desc, score desc
        limit ${limit}`;
      return rows.map((r) => ({
        sentAt: r.sent_at.toISOString(),
        link: r.link,
        source: r.source,
        theme: r.theme,
        title: r.title,
        publishedAt: r.published_at.toISOString(),
        score: r.score,
        resume: r.resume,
        project: r.project,
        idea: r.idea,
      }));
    },
  };
}
