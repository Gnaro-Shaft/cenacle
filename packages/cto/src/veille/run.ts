/**
 * One veille (J5, ADR-0024): read the feeds, ask the local model once, keep
 * the best articles, send the message. The local model away, or an answer
 * that cannot be read, is waited out and asked again — never another model
 * (ADR-0003); after the last attempt, the message says the veille was not
 * done. Only counts reach the journal: no title, no link, no summary.
 */
import { randomBytes } from "node:crypto";
import { ModelUnavailableError } from "@cenacle/brain";
import type { Journal } from "@cenacle/journal";
import { formatDigest, type Kept } from "./digest.ts";
import type { FeedItem, FeedRead } from "./feeds.ts";
import { buildVeillePrompt, parseScores, ScoreError } from "./score.ts";
import type { VeilleConfig } from "./sources.ts";

const AGENT = "cto";

export interface VeilleDeps {
  readonly config: VeilleConfig;
  readonly read: () => Promise<FeedRead>;
  /** One question to the local model; throws ModelUnavailableError when it is away. */
  readonly ask: (prompt: string) => Promise<string>;
  readonly send: (text: string) => Promise<void>;
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
    }
  | { readonly kind: "not_done"; readonly reason: string };

export const NOT_DONE =
  "⚠ Veille du CTO non faite : le modèle local n'a pas répondu après plusieurs essais. Elle repartira à la prochaine.";

const expected = (error: unknown): error is Error =>
  error instanceof ModelUnavailableError || error instanceof ScoreError;

async function keep(deps: VeilleDeps, items: readonly FeedItem[]): Promise<Kept[]> {
  const { settings, projects } = deps.config;
  if (items.length === 0) return [];
  const attempts = deps.attempts ?? 3;
  const retryMs = deps.retryMs ?? 600_000;
  for (let attempt = 1; ; attempt++) {
    try {
      const nonce = deps.nonce?.() ?? randomBytes(6).toString("hex");
      const prompt = buildVeillePrompt(items, projects, settings.profil, settings.seuil, nonce);
      const scored = parseScores(await deps.ask(prompt), items.length, projects, settings.seuil);
      return scored
        .filter((s) => s.score >= settings.seuil)
        .flatMap((s) => {
          const item = items[s.index];
          return item === undefined ? [] : [{ item, scored: s }];
        })
        .sort((a, b) => b.scored.score - a.scored.score || b.item.publishedAt - a.item.publishedAt)
        .slice(0, settings.maxRetenus);
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
  const read = await deps.read();
  const { maxParSource, maxArticles } = deps.config.settings;
  const items = selectItems(read.items, maxParSource, maxArticles);
  let kept: Kept[];
  try {
    kept = await keep(deps, items);
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
  await deps.send(
    formatDigest({
      date: deps.now(),
      scanned: items.length,
      kept,
      failed: read.failed,
      threshold: deps.config.settings.seuil,
      exampleProjects: deps.config.exampleProjects,
    }),
  );
  const outcome = {
    kind: "sent" as const,
    scanned: items.length,
    kept: kept.length,
    failed: read.failed.length,
  };
  await deps.journal.append({
    agent: AGENT,
    type: "veille.sent",
    payload: { scanned: outcome.scanned, kept: outcome.kept, failed: outcome.failed },
  });
  return outcome;
}
