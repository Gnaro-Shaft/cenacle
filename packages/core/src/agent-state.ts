/**
 * What the owner sees in an agent's box (ADR-0008).
 *
 * Internal states are detailed and live in the event log; the page only
 * shows three visual states, so that a glance is enough.
 */

export const INTERNAL_STATES = [
  "idle",
  "waiting_for_local_model",
  "reading",
  "thinking",
  "drafting",
  "error",
] as const;

export type InternalState = (typeof INTERNAL_STATES)[number];

export type VisualState = "resting" | "working" | "sick";

/** Notes are codes, not sentences: the page owns the wording (and the language). */
export type ViewNote = "waiting_for_mac" | "purge_failed" | "auth_missing";

export interface AgentView {
  readonly visual: VisualState;
  /** Why the agent shows this way, as a code the page translates; null if obvious. */
  readonly note: ViewNote | null;
}

export class UnknownStateError extends Error {
  constructor(value: unknown) {
    super(`Unknown agent state: ${JSON.stringify(value)}`);
    this.name = "UnknownStateError";
  }
}

export function isInternalState(value: unknown): value is InternalState {
  return typeof value === "string" && (INTERNAL_STATES as readonly string[]).includes(value);
}

/**
 * Maps an internal state to what the page shows.
 *
 * "sick" is reserved for real problems: waiting for the local model is
 * normal (the Mac sleeps while travelling) and shows as resting.
 * An unknown value throws — no silent fallback (charter, rule 3).
 */
export function toView(state: unknown): AgentView {
  if (!isInternalState(state)) {
    throw new UnknownStateError(state);
  }
  switch (state) {
    case "idle":
      return { visual: "resting", note: null };
    case "waiting_for_local_model":
      return { visual: "resting", note: "waiting_for_mac" };
    case "reading":
    case "thinking":
    case "drafting":
      return { visual: "working", note: null };
    case "error":
      return { visual: "sick", note: null };
    default: {
      const exhaustive: never = state;
      throw new UnknownStateError(exhaustive);
    }
  }
}
