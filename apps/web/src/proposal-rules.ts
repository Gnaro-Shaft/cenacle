/**
 * A draft card's words and rules, without React, so that they can be tested
 * (lot B, 13/11): what keeps « Accepter » locked, what accepting sends, the
 * undo delay as the server gives it, and refusing in two steps — a refusal
 * is final (ADR-0013), so one click never sends it.
 */
import type { ProposalView } from "./api.ts";

const SLOT_LEFT = /\{([a-z_]+) \?\}/g;

/** The slots left for me in a text, in order: `{heure ?}` gives `heure`. */
export const slotsLeft = (text: string): string[] =>
  [...text.matchAll(SLOT_LEFT)].map((m) => m[1] ?? "");

/** Why « Accepter » is locked; empty when it may be clicked. */
export function acceptBlockers(p: Pick<ProposalView, "mail" | "draft">, text: string): string[] {
  const left = slotsLeft(text);
  return [
    ...(p.mail === null
      ? ["le mail n'est plus sur le serveur (ce brouillon sera clos à la prochaine relève)"]
      : []),
    ...(p.mail !== null && p.mail.to === null ? ["l'adresse de l'expéditeur est illisible"] : []),
    ...(left.length > 0 ? [`case${left.length > 1 ? "s" : ""} à compléter`] : []),
    ...(text !== p.draft ? ["enregistre d'abord ta modification"] : []),
  ];
}

/**
 * What « Accepter » sends: the text the server showed me, never the text
 * area's — the server signs it only if it is still the stored one.
 */
export const acceptBody = (p: Pick<ProposalView, "draft">): { readonly draft: string } => ({
  draft: p.draft,
});

export const minutes = (n: number): string => `${n} minute${n > 1 ? "s" : ""}`;

export const acceptedMessage = (undoMinutes: number): string =>
  `Accepté : ${minutes(undoMinutes)} pour annuler.`;

export const realRecipientWarning = (undoMinutes: number): string =>
  "Destinataire réel : une fois acceptée, cette réponse partira vraiment chez ton " +
  `correspondant (${minutes(undoMinutes)} pour changer d'avis).`;

/** The line under an accepted draft: time left to cancel, or that it is the executor's now. */
export function countdown(
  sendAfter: string | null,
  now: number,
): { readonly left: number; readonly text: string } {
  const end = Date.parse(sendAfter ?? "");
  const left = Number.isNaN(end) ? 0 : Math.max(0, Math.ceil((end - now) / 1000));
  return {
    left,
    text:
      left > 0
        ? `✓ Accepté — annulable encore ${Math.floor(left / 60)} min ${String(left % 60).padStart(2, "0")} s`
        : "✓ Accepté — l'exécuteur l'envoie à son prochain passage (npm run executor)",
  };
}

export type RefuseStep = "idle" | "confirming";
export type RefuseClick = "refuse" | "confirm" | "keep";

/**
 * Refusing in two steps. Only « confirm » while confirming sends the refusal;
 * a « confirm » that arrives in any other step (a stale or double click)
 * sends nothing.
 */
export function refuseStep(
  step: RefuseStep,
  click: RefuseClick,
): { readonly step: RefuseStep; readonly send: boolean } {
  if (step === "idle") return { step: click === "refuse" ? "confirming" : "idle", send: false };
  if (click === "confirm") return { step: "idle", send: true };
  if (click === "keep") return { step: "idle", send: false };
  return { step: "confirming", send: false };
}
