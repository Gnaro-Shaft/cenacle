/**
 * What Iris writes on Telegram on her own: numbers and fixed words only.
 * No sender, no subject, no domain ever (ADR-0006). Tests check the shape.
 */
import type { Category } from "@cenacle/core";

export type NewCounts = Readonly<Record<Category, number>> & { readonly pending: number };

export function urgentAlert(count: number): string {
  return `🚨 ${count} mail${count > 1 ? "s" : ""} client urgent${count > 1 ? "s" : ""} — à lire sur la page.`;
}

export interface RecapInput {
  readonly hour: number;
  readonly fresh: NewCounts;
  readonly due: number;
  readonly waiting: number;
  /** Urgent client mails that arrived during quiet hours, never alerted. */
  readonly urgent: number;
  /** Drafts waiting for my validation (phase 4). */
  readonly drafts?: number;
}

export function recap({ hour, fresh, due, waiting, urgent, drafts = 0 }: RecapInput): string {
  const lines = [`📬 Iris — récap de ${hour} h`];
  const total =
    fresh.clients_prospects + fresh.administratif + fresh.bruit + fresh.a_trier + fresh.pending;
  lines.push(
    total === 0
      ? "Rien de nouveau depuis le dernier récap."
      : `Nouveaux : ${fresh.clients_prospects} clients · ${fresh.administratif} admin · ${fresh.bruit} bruit · ${fresh.a_trier} à trier${fresh.pending > 0 ? ` · ${fresh.pending} pas encore triés` : ""}`,
  );
  if (urgent > 0) {
    lines.push(
      `🚨 ${urgent} mail${urgent > 1 ? "s" : ""} client urgent${urgent > 1 ? "s" : ""} pas encore signalé${urgent > 1 ? "s" : ""}`,
    );
  }
  lines.push(
    due > 0 || waiting > 0
      ? `🔔 ${due} à relancer · ⏳ ${waiting} en attente de réponse`
      : "Aucune réponse en retard.",
  );
  if (drafts > 0) {
    lines.push(`✏️ ${drafts} brouillon${drafts > 1 ? "s" : ""} à valider — sur la page`);
  }
  return lines.join("\n");
}
