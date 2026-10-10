/**
 * The security agent's vocabulary (J6, ADR-0025). A check either ran and says
 * what it saw, or could not run — and a check that could not run proves
 * nothing: it never closes a finding (Legion's rule: "a missing verdict cures
 * nothing").
 */

export const SEVERITIES = ["info", "faible", "moyen", "eleve", "critique"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_LABEL: Readonly<Record<Severity, string>> = {
  info: "information",
  faible: "faible",
  moyen: "moyen",
  eleve: "élevé",
  critique: "critique",
};

/** What identifies one situation: one open finding at most per key. */
export interface FindingKey {
  /** A kind from the closed catalogue (catalogue.ts). */
  readonly type: string;
  /** What it is about: a package, an update label, "mac". */
  readonly target: string;
  /** Which occurrence: an advisory, a version. A new one is a new finding. */
  readonly occurrence: string;
}

export interface Observation extends FindingKey {
  readonly severity: Severity;
  /** One line, in French, built by the parser: never a tool's raw output. */
  readonly title: string;
  /** Validated values the catalogue may put in a proposed command. */
  readonly params?: Readonly<Record<string, string>>;
}

export type CheckResult =
  | { readonly check: string; readonly ran: true; readonly observations: readonly Observation[] }
  | { readonly check: string; readonly ran: false };

export class CheckOutputError extends Error {
  constructor(check: string) {
    super(`${check}: unexpected output`);
    this.name = "CheckOutputError";
  }
}

export const keyOf = (k: FindingKey) => `${k.type}\u0000${k.target}\u0000${k.occurrence}`;
