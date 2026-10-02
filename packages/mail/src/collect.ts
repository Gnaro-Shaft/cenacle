/**
 * One collection pass by Iris: journaled, and visible on her box.
 *
 * The journal gets facts, not content (charter): how many mails, whether the
 * ceiling was hit, how long it took — never a UID, a domain or a subject.
 */
import type { Journal } from "@cenacle/journal";
import type { FetchResult } from "./postman.ts";

const AGENT = "iris";

export interface CollectSummary {
  readonly count: number;
  readonly domains: number;
  readonly truncated: boolean;
  readonly lastUid: number | null;
  readonly unseen: number;
  readonly durationMs: number;
}

export interface CollectDeps {
  readonly journal: Journal;
  readonly fetch: () => Promise<FetchResult>;
  readonly now?: () => number;
}

export async function collectMail(deps: CollectDeps): Promise<CollectSummary> {
  const { journal, fetch, now = () => performance.now() } = deps;
  await journal.append({ agent: AGENT, type: "state.changed", payload: { to: "reading" } });
  const started = now();
  let result: FetchResult;
  try {
    result = await fetch();
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
  await journal.append({ agent: AGENT, type: "state.changed", payload: { to: "idle" } });
  return {
    count: result.refs.length,
    domains: new Set(result.refs.map((ref) => ref.domain)).size,
    truncated: result.truncated,
    lastUid: result.lastUid,
    unseen: result.unseen,
    durationMs,
  };
}
