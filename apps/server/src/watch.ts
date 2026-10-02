/**
 * Follows an agent's events and reports each status change.
 *
 * Polls the journal (simple, enough for one person). A projection error is
 * reported as a problem and stops the watch: we never guess past an event
 * we do not understand.
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
  readonly agent: string;
  readonly readAfter: ReadAfter;
  readonly send: (message: AgentMessage) => Promise<void>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly isClosed: () => boolean;
  readonly intervalMs?: number;
}

export async function watchAgent(options: WatchOptions): Promise<void> {
  const { agent, readAfter, send, sleep, isClosed } = options;
  let status = initialStatus(agent);
  let first = true;
  while (!isClosed()) {
    const events = await readAfter(agent, status.lastEventId ?? 0n);
    try {
      for (const event of events) status = applyEvent(status, event);
    } catch (error) {
      if (!(error instanceof ProjectionError)) throw error;
      await send({ kind: "problem", agent, message: error.message });
      return;
    }
    if (first || events.length > 0) await send(toStatusMessage(status));
    first = false;
    await sleep(options.intervalMs ?? 500);
  }
}
