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
  /**
   * The last purge failed: retentions are not kept (C1). Shown as sick until
   * a purge succeeds — a GDPR failure must be seen, not only journaled.
   */
  readonly purgeFailing: boolean;
  /**
   * The last pass with new mails found our receiving server's header in none
   * of them (ADR-0014): no sender can be authenticated, every client rule is
   * refused. Shown as sick until a pass finds it again.
   */
  readonly authMissing: boolean;
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
  "alert.sent",
  "recap.sent",
  "notify.failed", // once per Telegram outage; the messages are retried each minute
  "notify.recovered", // Telegram is back: how many minutes it was away
  "veille.sent", // the CTO's veille was sent: counts only (J5)
  "veille.failed", // the local model did not answer: the message said so
  "securite.ran", // a round of the security agent: counts only (J6)
  "securite.bilan", // the weekly security review was sent
  "send.lapsed",
  "send.cancelled",
  "proposal.skipped", // Iris decided not to propose: nothing waits for me
  "draft.failed", // drafting failed (model away…): the follow-ups wait for the next pass
  "send.sent", // the executor sent an accepted reply (B4)
  "send.failed", // the mail server refused it: shown to me, never retried
  "send.copy_failed", // sent, but the copy in Sent failed
  "send.limit_reached", // 20 attempts today: the rest waits for tomorrow
  "send.unsigned", // an acceptance without a valid page signature: refused, never sent (B7)
  "mail.set_aside", // summary (C2): the counts are set again by mail.totals at the end of the pass
  "person.exported", // the rights of a person (C3): counts only
  "person.erased",
  "person.withdrawn",
  "stop.requested", // the emergency stop (/stop), read by the executor
  "telegram.rejected", // a message from someone else than me, ignored
  "cto.verified", // the CTO's answer checked against the repository: counts only (ADR-0017)
  "dev.memory.wiped", // the test box memory, emptied once by hand before the real box (M2)
]);

/** Event types the projection reads itself (the switch below). */
const HANDLED_EVENT_TYPES: ReadonlySet<string> = new Set([
  "state.changed",
  "proposal.created",
  "proposal.closed",
  "mail.fetched",
  "mail.sorted_by_rules",
  "mail.model_sorted",
  "mail.totals",
  "mail.sender_auth",
  "purge.done",
  "purge.failed",
]);

/** Every event type the projection knows: anything else makes it fail (rule 3). */
export function isKnownEventType(type: string): boolean {
  return HANDLED_EVENT_TYPES.has(type) || NEUTRAL_EVENT_TYPES.has(type);
}

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
    purgeFailing: false,
    authMissing: false,
    lastEventId: null,
  };
}

/** A failed purge or lost authentication outranks the internal state: real problems. */
function viewOf(
  internal: InternalState,
  health: Pick<AgentStatus, "purgeFailing" | "authMissing">,
): AgentView {
  if (health.purgeFailing) return { visual: "sick", note: "purge_failed" };
  if (health.authMissing) return { visual: "sick", note: "auth_missing" };
  return toView(internal);
}

function withHealth(
  status: AgentStatus,
  health: Partial<Pick<AgentStatus, "purgeFailing" | "authMissing">>,
): AgentStatus {
  const next = { ...status, ...health };
  return { ...next, view: viewOf(next.internal, next) };
}

/** mail.sender_auth: counts of a pass; `trusted` among `mails` carried our server's header. */
function authMissingOf(event: AgentEvent): boolean {
  const { mails, trusted } = event.payload;
  for (const [name, value] of [
    ["mails", mails],
    ["trusted", trusted],
  ] as const) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      throw new ProjectionError(event, `invalid ${name} ${JSON.stringify(value)}`);
    }
  }
  if ((trusted as number) > (mails as number)) {
    throw new ProjectionError(event, "more trusted headers than mails");
  }
  return (mails as number) > 0 && trusted === 0;
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
      return {
        ...next,
        internal: to,
        view: viewOf(to, next),
        since: event.occurredAt,
      };
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
    case "purge.failed":
      return withHealth(next, { purgeFailing: true });
    case "purge.done":
      return withHealth(next, { purgeFailing: false });
    case "mail.sender_auth":
      return withHealth(next, { authMissing: authMissingOf(event) });
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
