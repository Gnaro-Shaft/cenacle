/**
 * One veille (J5, ADR-0024): read the feeds, leave out what I already got,
 * ask the local model once, keep the best articles, send the message, archive
 * what it showed. The local model away, or an answer that cannot be read, is
 * waited out and asked again — never another model (ADR-0003); after the last
 * attempt, the message says the veille was not done. Never twice the same
 * news: a link already sent is left out by code; the same news under another
 * link, by the model, told the titles of the last days (not infallible).
 * Only counts reach the journal: no title, no link, no summary.
 */
import { randomBytes } from "node:crypto";
import { ModelUnavailableError } from "@cenacle/brain";
import type { Journal } from "@cenacle/journal";
import { formatDigest, type Kept } from "./digest.ts";
import type { FeedItem, FeedRead } from "./feeds.ts";
import { buildVeillePrompt, parseScores, ScoreError } from "./score.ts";
import type { VeilleConfig } from "./sources.ts";

const AGENT = "cto";
const DAY_MS = 24 * 3_600_000;
/** The titles of the last week go to the model, as "already sent". */
const RECENT_DAYS = 7;
const RECENT_MAX = 60;

/** What was sent before (the archive, VeilleStore). */
export interface VeilleMemory {
  sentLinks(links: readonly string[]): Promise<ReadonlySet<string>>;
  recentTitles(since: Date, limit: number): Promise<string[]>;
  record(
    articles: readonly {
      link: string;
      source: string;
      theme: FeedItem["theme"];
      title: string;
      publishedAt: string;
      score: number;
      resume: string | null;
      project: string | null;
      idea: string | null;
    }[],
  ): Promise<number>;
  purge(cutoff: Date): Promise<number>;
}

export interface VeilleDeps {
  readonly config: VeilleConfig;
  readonly read: () => Promise<FeedRead>;
  /** One question to the local model; throws ModelUnavailableError when it is away. */
  readonly ask: (prompt: string) => Promise<string>;
  readonly send: (text: string) => Promise<void>;
  readonly memory: VeilleMemory;
  readonly journal: Journal;
  readonly now: () => Date;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log?: (line: string) => void;
  readonly nonce?: () => string;
  readonly attempts?: number;
  readonly retryMs?: number;
}

export type VeilleOutcome =
  | {
      readonly kind: "sent";
      readonly scanned: number;
      readonly kept: number;
      readonly failed: number;
      /** Left out as already sent: by link, then by the model. */
      readonly repeated: number;
      readonly archived: number;
    }
  | { readonly kind: "not_done"; readonly reason: string };

export const NOT_DONE =
  "⚠ Veille du CTO non faite : le modèle local n'a pas répondu après plusieurs essais. Elle repartira à la prochaine.";

const expected = (error: unknown): error is Error =>
  error instanceof ModelUnavailableError || error instanceof ScoreError;

async function keep(
  deps: VeilleDeps,
  items: readonly FeedItem[],
  alreadySent: readonly string[],
): Promise<{ kept: Kept[]; duplicates: number }> {
  const { settings, projects } = deps.config;
  if (items.length === 0) return { kept: [], duplicates: 0 };
  const attempts = deps.attempts ?? 3;
  const retryMs = deps.retryMs ?? 600_000;
  for (let attempt = 1; ; attempt++) {
    try {
      const nonce = deps.nonce?.() ?? randomBytes(6).toString("hex");
      const prompt = buildVeillePrompt(
        items,
        projects,
        settings.profil,
        settings.seuil,
        nonce,
        alreadySent,
      );
      const scored = parseScores(await deps.ask(prompt), items.length, projects, settings.seuil);
      const good = scored.filter((s) => s.score >= settings.seuil);
      const kept = good
        .filter((s) => !s.duplicate)
        .flatMap((s) => {
          const item = items[s.index];
          return item === undefined ? [] : [{ item, scored: s }];
        })
        .sort((a, b) => b.scored.score - a.scored.score || b.item.publishedAt - a.item.publishedAt)
        .slice(0, settings.maxRetenus);
      return { kept, duplicates: good.filter((s) => s.duplicate).length };
    } catch (error) {
      if (!expected(error) || attempt >= attempts) throw error;
      deps.log?.(`⚠ Veille : ${error.name}, nouvel essai dans ${Math.round(retryMs / 60_000)} min`);
      await deps.sleep(retryMs);
    }
  }
}

/** The newest first, at most `perSource` from each source, `max` in all. */
export function selectItems(
  items: readonly FeedItem[],
  perSource: number,
  max: number,
): FeedItem[] {
  const counts = new Map<string, number>();
  const chosen: FeedItem[] = [];
  for (const item of [...items].sort((a, b) => b.publishedAt - a.publishedAt)) {
    const n = counts.get(item.source) ?? 0;
    if (n >= perSource) continue;
    counts.set(item.source, n + 1);
    chosen.push(item);
    if (chosen.length >= max) break;
  }
  return chosen;
}

export async function runVeille(deps: VeilleDeps): Promise<VeilleOutcome> {
  const { settings } = deps.config;
  const now = deps.now();
  const read = await deps.read();
  const sent = await deps.memory.sentLinks(read.items.map((i) => i.link));
  const fresh = read.items.filter((i) => !sent.has(i.link));
  const items = selectItems(fresh, settings.maxParSource, settings.maxArticles);
  const recent = await deps.memory.recentTitles(
    new Date(now.getTime() - RECENT_DAYS * DAY_MS),
    RECENT_MAX,
  );
  let kept: Kept[];
  let duplicates: number;
  try {
    ({ kept, duplicates } = await keep(deps, items, recent));
  } catch (error) {
    if (!expected(error)) throw error;
    await deps.journal.append({
      agent: AGENT,
      type: "veille.failed",
      payload: { reason: error.name },
    });
    await deps.send(NOT_DONE);
    return { kind: "not_done", reason: error.name };
  }
  const digest = formatDigest({
    date: now,
    scanned: items.length,
    kept,
    failed: read.failed,
    threshold: settings.seuil,
    exampleProjects: deps.config.exampleProjects,
  });
  // Sent first: a message that failed to leave archives nothing, nothing is lost.
  await deps.send(digest.text);
  const archived = await deps.memory.record(
    digest.shown.map(({ item, scored }) => ({
      link: item.link,
      source: item.source,
      theme: item.theme,
      title: item.title,
      publishedAt: new Date(item.publishedAt).toISOString(),
      score: scored.score,
      resume: scored.resume,
      project: scored.project,
      idea: scored.idea,
    })),
  );
  await deps.memory.purge(new Date(now.getTime() - settings.veilleJours * DAY_MS));
  const outcome = {
    kind: "sent" as const,
    scanned: items.length,
    kept: kept.length,
    failed: read.failed.length,
    repeated: read.items.length - fresh.length + duplicates,
    archived,
  };
  const { kind: _, ...counts } = outcome;
  await deps.journal.append({ agent: AGENT, type: "veille.sent", payload: counts });
  return outcome;
}
