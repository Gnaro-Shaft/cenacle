/**
 * One collection pass by Iris: journaled, and visible on her box.
 *
 * The journal gets facts, not content (charter): how many mails, how many per
 * category, how long it took — never a UID, a domain or a subject.
 */
import type { Journal } from "@cenacle/journal";
import type { FetchResult } from "./postman.ts";
import { type RuleSort, type Rules, sortByRules } from "./rules.ts";

const AGENT = "iris";

export interface CollectSummary {
  readonly count: number;
  readonly domains: number;
  readonly truncated: boolean;
  readonly lastUid: number | null;
  readonly unseen: number;
  readonly durationMs: number;
  /** Present when rules were given. */
  readonly ruleSort?: RuleSort;
}

export interface CollectDeps {
  readonly journal: Journal;
  readonly fetch: () => Promise<FetchResult>;
  /** If given, mails are sorted by these rules after the fetch. */
  readonly rules?: Rules;
  readonly now?: () => number;
}

export async function collectMail(deps: CollectDeps): Promise<CollectSummary> {
  const { journal, fetch, rules, now = () => performance.now() } = deps;
  await journal.append({ agent: AGENT, type: "state.changed", payload: { to: "reading" } });
  const started = now();
  let result: FetchResult;
  let ruleSort: RuleSort | undefined;
  try {
    result = await fetch();
    if (rules !== undefined) ruleSort = sortByRules(result.refs, rules);
  } catch (error) {
    // No message: an IMAP error may echo server data. The name is enough to start looking.
    const reason = error instanceof Error ? error.name : "unknown";
    await journal.append({ agent: AGENT, type: "mail.fetch_failed", payload: { reason } });
    await journal.append({ agent: AGENT, type: "state.changed", payload: { to: "error" } });
    throw error;
  }
  const durationMs = Math.round(now() - started);
  await journal.append({
    agent: AGENT,
    type: "mail.fetched",
    payload: { count: result.refs.length, truncated: result.truncated, durationMs },
  });
  if (ruleSort !== undefined) {
    await journal.append({
      agent: AGENT,
      type: "mail.sorted_by_rules",
      payload: { ...ruleSort.counts },
    });
  }
  await journal.append({ agent: AGENT, type: "state.changed", payload: { to: "idle" } });
  return {
    count: result.refs.length,
    domains: new Set(result.refs.map((ref) => ref.domain)).size,
    truncated: result.truncated,
    lastUid: result.lastUid,
    unseen: result.unseen,
    durationMs,
    ...(ruleSort === undefined ? {} : { ruleSort }),
  };
}
