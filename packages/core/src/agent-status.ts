/**
 * An agent's status, computed from its events (ADR-0008).
 *
 * The journal is the only source of truth: nothing here is stored, and the
 * same events always give the same status. Anything unexpected throws —
 * an event we do not understand must never be quietly skipped.
 */
import { type AgentView, type InternalState, isInternalState, toView } from "./agent-state.ts";
import {
  applyModelSort,
  applyRuleSort,
  applyTotals,
  type MailCounts,
  MailCountsError,
  startPass,
} from "./mail-counts.ts";

/** The shape of a journal event, as far as the projection is concerned. */
export interface AgentEvent {
  readonly id: bigint;
  readonly occurredAt: Date;
  readonly agent: string;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface AgentStatus {
  readonly agent: string;
  readonly internal: InternalState;
  readonly view: AgentView;
  /** When the current internal state began; null if the agent never changed state. */
  readonly since: Date | null;
  /** Proposals waiting for the owner's decision: the number in the bubble. */
  readonly pendingApprovals: number;
  readonly pendingProposalIds: readonly string[];
  /** The mails Iris remembers, per category; null before the first pass. */
  readonly mail: MailCounts | null;
  /** Id of the last event applied; the next one must be greater. */
  readonly lastEventId: bigint | null;
}

export class ProjectionError extends Error {
  constructor(event: AgentEvent, message: string) {
    super(`Event #${event.id} (${event.type}): ${message}`);
    this.name = "ProjectionError";
  }
}

/** Event types that exist but do not change an agent's status. */
const NEUTRAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  "heartbeat",
  "model.routed",
  "model.answered",
  "mail.fetch_failed",
  "mail.sorted_by_model", // summary of the per-mail events below
  "mail.model_waiting",
]);

const PROPOSAL_OUTCOMES: ReadonlySet<string> = new Set([
  "accepted",
  "refused",
  "lapsed",
  "cancelled",
]);
const PROPOSAL_ID_RULE = /^[A-Za-z0-9_-]{1,64}$/;

export function initialStatus(agent: string): AgentStatus {
  return {
    agent,
    internal: "idle",
    view: toView("idle"),
    since: null,
    pendingApprovals: 0,
    pendingProposalIds: [],
    mail: null,
    lastEventId: null,
  };
}

function proposalId(event: AgentEvent): string {
  const id = event.payload.proposalId;
  if (typeof id !== "string" || !PROPOSAL_ID_RULE.test(id)) {
    throw new ProjectionError(event, `invalid proposalId ${JSON.stringify(id)}`);
  }
  return id;
}

function withPending(status: AgentStatus, ids: readonly string[]): AgentStatus {
  return { ...status, pendingProposalIds: ids, pendingApprovals: ids.length };
}

function applyMailEvent(counts: MailCounts | null, event: AgentEvent): MailCounts {
  if (event.type === "mail.fetched") return startPass(counts, event.payload);
  if (event.type === "mail.totals") return applyTotals(event.payload);
  if (event.type === "mail.sorted_by_rules") return applyRuleSort(counts, event.payload);
  return applyModelSort(counts, event.payload);
}

/** Applies one event to a status and returns a new status (never mutates). */
export function applyEvent(status: AgentStatus, event: AgentEvent): AgentStatus {
  if (event.agent !== status.agent) {
    throw new ProjectionError(event, `belongs to "${event.agent}", not "${status.agent}"`);
  }
  if (status.lastEventId !== null && event.id <= status.lastEventId) {
    throw new ProjectionError(event, `out of order (last applied: #${status.lastEventId})`);
  }
  const next = { ...status, lastEventId: event.id };

  switch (event.type) {
    case "state.changed": {
      const to = event.payload.to;
      if (!isInternalState(to)) {
        throw new ProjectionError(event, `unknown target state ${JSON.stringify(to)}`);
      }
      return { ...next, internal: to, view: toView(to), since: event.occurredAt };
    }
    case "proposal.created": {
      const id = proposalId(event);
      if (next.pendingProposalIds.includes(id)) {
        throw new ProjectionError(event, `proposal ${id} is already pending`);
      }
      return withPending(next, [...next.pendingProposalIds, id]);
    }
    case "proposal.closed": {
      const id = proposalId(event);
      const outcome = event.payload.outcome;
      if (typeof outcome !== "string" || !PROPOSAL_OUTCOMES.has(outcome)) {
        throw new ProjectionError(event, `unknown outcome ${JSON.stringify(outcome)}`);
      }
      if (!next.pendingProposalIds.includes(id)) {
        throw new ProjectionError(event, `proposal ${id} is not pending`);
      }
      return withPending(
        next,
        next.pendingProposalIds.filter((pending) => pending !== id),
      );
    }
    case "mail.fetched":
    case "mail.sorted_by_rules":
    case "mail.model_sorted":
    case "mail.totals":
      try {
        return { ...next, mail: applyMailEvent(next.mail, event) };
      } catch (error) {
        if (error instanceof MailCountsError) throw new ProjectionError(event, error.message);
        throw error;
      }
    default:
      if (NEUTRAL_EVENT_TYPES.has(event.type)) return next;
      throw new ProjectionError(event, "unknown event type — declare it before using it");
  }
}

/** Replays an agent's events, oldest first, into its current status. */
export function projectStatus(agent: string, events: Iterable<AgentEvent>): AgentStatus {
  let status = initialStatus(agent);
  for (const event of events) status = applyEvent(status, event);
  return status;
}
