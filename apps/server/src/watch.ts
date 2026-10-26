/**
 * Follows agents' events and reports each status change.
 *
 * Polls the journal (simple, enough for one person). A projection error is
 * reported as a problem and stops watching that agent: we never guess past
 * an event we do not understand. The others go on.
 *
 * Several agents share one watch, so the page holds one stream for its whole
 * team (2026-10-26): a browser opens at most 6 connections to one address,
 * and six cards, one stream each, left none for the page's other calls.
 */
import {
  type AgentEvent,
  type AgentMessage,
  applyEvent,
  initialStatus,
  ProjectionError,
  toStatusMessage,
} from "@cenacle/core";

export type ReadAfter = (agent: string, afterId: bigint) => Promise<readonly AgentEvent[]>;

export interface WatchOptions {
  readonly agents: readonly string[];
  readonly readAfter: ReadAfter;
  readonly send: (message: AgentMessage) => Promise<void>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly isClosed: () => boolean;
  readonly intervalMs?: number;
}

export async function watchAgents(options: WatchOptions): Promise<void> {
  const { agents, readAfter, send, sleep, isClosed } = options;
  const statuses = new Map(agents.map((agent) => [agent, initialStatus(agent)]));
  const stopped = new Set<string>();
  let first = true;
  while (!isClosed()) {
    for (const agent of agents) {
      if (stopped.has(agent)) continue;
      let status = statuses.get(agent) ?? initialStatus(agent);
      const events = await readAfter(agent, status.lastEventId ?? 0n);
      try {
        for (const event of events) status = applyEvent(status, event);
      } catch (error) {
        if (!(error instanceof ProjectionError)) throw error;
        stopped.add(agent);
        await send({ kind: "problem", agent, message: error.message });
        continue;
      }
      statuses.set(agent, status);
      if (first || events.length > 0) await send(toStatusMessage(status));
    }
    first = false;
    if (stopped.size === agents.length) return;
    await sleep(options.intervalMs ?? 500);
  }
}

/** One agent alone (its own route, kept for the CLI and older pages). */
export function watchAgent(options: Omit<WatchOptions, "agents"> & { readonly agent: string }) {
  const { agent, ...rest } = options;
  return watchAgents({ ...rest, agents: [agent] });
}
