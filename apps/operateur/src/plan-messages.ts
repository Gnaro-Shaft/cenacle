/**
 * What the operator tells me of a maintenance plan (ADR-0035, J7d): one
 * message when it starts, one line per machine once its steps are settled,
 * one when it stops, ends or expires. Plain words, machine names and steps —
 * never a server's output, an address or a key path.
 */
import type { PlanStep, StoredPlan } from "@cenacle/journal";

const ICON = { maj_securite: "⬆", services: "🔁", redemarrer: "🔄" } as const;

const WHY: Readonly<Record<string, string>> = {
  interrupteur: "le récapitulatif de maintenance a été coupé ([maintenance] actif)",
  preuve_toujours_la: "le relevé de Legion montre encore le problème",
  preuve_pas_revenue: "la machine n'est pas revenue 30 minutes après le redémarrage",
  preuve_reduit: "il reste plus de services que ceux que le script épargne",
  refus_serveur: "un garde-fou du serveur a refusé",
  echec: "l'action a échoué sur la machine",
  etat_inconnu: "l'action a été coupée en cours (Mac endormi ?) — état inconnu",
  injoignable: "serveur injoignable ou clé refusée",
  action_disparue: "l'action lancée est introuvable",
};

function why(reason: string | null): string {
  if (reason === null) return "raison inconnue";
  if (reason.startsWith("refus_")) return `refus de l'opérateur (${reason.slice(6)})`;
  return WHY[reason] ?? reason;
}

function word(s: PlanStep): string {
  switch (s.state) {
    case "faite":
      return s.action === "redemarrer" ? "revenue" : "fait";
    case "sautee":
      return s.reason === "rien_a_faire" ? "rien à faire" : "sauté";
    case "arretee":
      return "arrêté";
    case "retiree":
      return "retiré";
    case "annulee":
      return "annulé";
    default:
      return "en attente";
  }
}

const hostsOf = (plan: StoredPlan) => [
  ...new Set(plan.steps.filter((s) => s.state !== "retiree").map((s) => s.host)),
];

export function planStarted(plan: StoredPlan): string {
  return `▶ Plan n°${plan.id} lancé : ${hostsOf(plan).join(", ")}. Je te dis machine par machine ; au premier accroc, j'arrête tout.`;
}

/** A machine's line, once none of its steps waits. */
export function machineDone(plan: StoredPlan, host: string): string {
  const steps = plan.steps.filter((s) => s.host === host && s.state !== "retiree");
  const stopped = steps.some((s) => s.state === "arretee");
  const line = steps.map((s) => `${ICON[s.action]} ${word(s)}`).join(" · ");
  return `${stopped ? "🛑" : "✅"} ${host} : ${line}`;
}

export function planStopped(plan: StoredPlan, step: PlanStep, reason: string): string {
  const cancelled = plan.steps.filter((s) => s.state === "annulee").length;
  return `🛑 Plan n°${plan.id} arrêté sur ${step.host} (${ICON[step.action]}) : ${why(reason)}. ${cancelled} étape(s) non lancée(s), annulée(s). Rien d'autre ne sera fait sans toi.`;
}

export function planEnded(plan: StoredPlan): string {
  const done = plan.steps.filter((s) => s.state === "faite").length;
  const skipped = plan.steps.filter((s) => s.state === "sautee").length;
  return `✅ Plan n°${plan.id} terminé : ${done} étape(s) faite(s), ${skipped} sautée(s) (plus rien à faire au moment voulu).`;
}

export function planExpired(plan: StoredPlan): string {
  const cancelled = plan.steps.filter((s) => s.state === "annulee").length;
  return `⌛ Plan n°${plan.id} expiré, 6 heures après ta confirmation : ${cancelled} étape(s) non lancée(s), annulée(s). Elles reviendront au prochain récapitulatif.`;
}

export function planSwitchedOff(plan: StoredPlan): string {
  const cancelled = plan.steps.filter((s) => s.state === "annulee").length;
  return `🛑 Plan n°${plan.id} arrêté : ${why("interrupteur")}. ${cancelled} étape(s) annulée(s) ; celle en cours, s'il y en avait une, va à son terme.`;
}
