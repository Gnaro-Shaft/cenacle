/**
 * The four columns of the board (ADR-0032, points 9 to 14), decided on data:
 * Detected → Direct client (no intermediary) → My profile → Alert. A card
 * stops at the first column it cannot pass, with its reason and its decider.
 *
 * Rules first, without AI: an ESN of the list or a phrase that betrays an
 * intermediary always beats the model. Then the model's own word: "esn" stops,
 * and doubt ("inconnu") does not pass. My profile is compared by code only.
 * An unsaid rate or remote work never refuses a mission: it passes, flagged.
 */
import type { ProspectionConfig } from "./config.ts";
import type { Offer } from "./extract.ts";
import { hasWords, normalized } from "./text.ts";

/** The agent's columns, in order; mine follow (lot 3, moved by me only). */
export const AGENT_COLUMNS = ["detected", "direct", "profile", "alert"] as const;
export const MY_COLUMNS = [
  "contacted",
  "applied",
  "interview",
  "won",
  "lost",
  "dismissed",
] as const;
export type AgentColumn = (typeof AGENT_COLUMNS)[number];
export type Column = AgentColumn | (typeof MY_COLUMNS)[number];

export const STOP_REASONS = [
  "esn_list",
  "esn_phrase",
  "esn_model",
  "intermediary_unknown",
  "stack",
  "rate",
  "remote",
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export type Decider = "rule" | "model" | "me";

export interface Triage {
  /** The furthest column reached. */
  readonly column: AgentColumn;
  /** Why it stopped there; null when it reached the alert. */
  readonly reason: StopReason | null;
  readonly decidedBy: Decider;
  /** An unsaid rate or remote work: passed, to check by me. */
  readonly toCheck: boolean;
}

/** Who filled the fields: the model from a mail, or me by hand (no model then). */
export type Source = "mail" | "me";

function intermediary(
  offer: Offer,
  config: ProspectionConfig,
  source: Source,
): { reason: StopReason; by: Decider } | null {
  const said = normalized([offer.title, offer.company ?? "", offer.place ?? ""].join(" "));
  if (config.esn.some((name) => hasWords(said, name))) return { reason: "esn_list", by: "rule" };
  if (config.phrases.some((phrase) => hasWords(said, phrase))) {
    return { reason: "esn_phrase", by: "rule" };
  }
  const by: Decider = source === "me" ? "me" : "model";
  if (offer.intermediary === "esn") return { reason: "esn_model", by };
  if (offer.intermediary === "inconnu") return { reason: "intermediary_unknown", by };
  return null;
}

function matchesStack(offer: Offer, config: ProspectionConfig): boolean {
  return offer.stack.some((word) => {
    const w = normalized(word);
    return config.profile.stack.has(w) || [...config.profile.stack].some((p) => hasWords(w, p));
  });
}

function placeAccepted(offer: Offer, config: ProspectionConfig): boolean {
  if (offer.place === null) return false;
  const place = normalized(offer.place);
  return [...config.profile.places].some((p) => hasWords(place, p));
}

export function triage(offer: Offer, config: ProspectionConfig, source: Source): Triage {
  const stopped = intermediary(offer, config, source);
  if (stopped !== null) {
    return { column: "detected", reason: stopped.reason, decidedBy: stopped.by, toCheck: false };
  }
  const stop = (reason: StopReason): Triage => ({
    column: "direct",
    reason,
    decidedBy: "rule",
    toCheck: false,
  });
  if (!matchesStack(offer, config)) return stop("stack");
  if (offer.rate !== null && offer.rate[1] < config.profile.minRate) return stop("rate");
  const remoteKnown = offer.remote !== "inconnu";
  if (remoteKnown && !config.profile.remote.has(offer.remote) && !placeAccepted(offer, config)) {
    return stop("remote");
  }
  return {
    column: "alert",
    reason: null,
    decidedBy: "rule",
    toCheck: offer.rate === null || !remoteKnown,
  };
}

/**
 * The same mission twice (point 9): same platform, title, company and place,
 * without case or accents. Without a company, never: better a duplicate card
 * than a lost mission. Links are never compared: each alert has its own.
 */
export function duplicateKey(offer: Offer, platform: string): string | null {
  if (offer.company === null) return null;
  return [platform, offer.title, offer.company, offer.place ?? ""].map(normalized).join("|");
}
