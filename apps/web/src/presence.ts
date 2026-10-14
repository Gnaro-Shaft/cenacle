/**
 * How an agent shows on the page (in the spirit of Myriade, 2026-10-14): a
 * ring around its emblem, and always the same thing said in words — colour is
 * never the only sign. Red only for what waits on me or is broken; amber for
 * work in progress; ink and grey for the rest.
 */
import type { VisualState } from "@cenacle/core";

export type Visual = VisualState | "offline";
export type Ring = "repos" | "travail" | "accord" | "malade" | "absent";

export interface Presence {
  readonly ring: Ring;
  readonly label: string;
}

const BASE: Readonly<Record<Visual, Presence>> = {
  resting: { ring: "repos", label: "au repos" },
  working: { ring: "travail", label: "au travail" },
  sick: { ring: "malade", label: "malade" },
  offline: { ring: "absent", label: "hors ligne" },
};

/** Drafts waiting for me win over rest and work, never over sick or offline. */
export function presence(visual: Visual, pending: number): Presence {
  if (pending > 0 && (visual === "resting" || visual === "working")) {
    return { ring: "accord", label: "attend ton accord" };
  }
  return BASE[visual];
}

export const RINGS: readonly Ring[] = ["repos", "travail", "accord", "malade", "absent"];
