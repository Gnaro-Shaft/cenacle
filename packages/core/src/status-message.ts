/**
 * What travels from the server to the page: JSON-safe (no bigint, no Date).
 * Contains no mail content — only states, counts and ids (ADR-0005).
 */
import type { ViewNote, VisualState } from "./agent-state.ts";
import type { AgentStatus } from "./agent-status.ts";

export interface StatusMessage {
  readonly kind: "status";
  readonly agent: string;
  readonly visual: VisualState;
  readonly internal: string;
  readonly note: ViewNote | null;
  readonly since: string | null;
  readonly pendingApprovals: number;
  readonly lastEventId: string | null;
}

/** Sent when the journal cannot be projected: the agent is shown sick, with the reason. */
export interface ProblemMessage {
  readonly kind: "problem";
  readonly agent: string;
  readonly message: string;
}

export type AgentMessage = StatusMessage | ProblemMessage;

export function toStatusMessage(status: AgentStatus): StatusMessage {
  return {
    kind: "status",
    agent: status.agent,
    visual: status.view.visual,
    internal: status.internal,
    note: status.view.note,
    since: status.since?.toISOString() ?? null,
    pendingApprovals: status.pendingApprovals,
    lastEventId: status.lastEventId?.toString() ?? null,
  };
}
