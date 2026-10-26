/**
 * The maintenance plan's buttons (J7d, ADR-0035): under the summary,
 * ✅ Valider le plan and, machine by machine, "Retirer 🔄 de …" and
 * "Retirer …"; under the question that follows, ✅ Confirmer (2 min). Read
 * strictly: a prefix of their own ("m:"), the plan's number, a machine's
 * place in the plan — never its name —, a 16-hex token. The plan's text and
 * the question say exactly what will run. No model anywhere.
 */
import type { ServerActionName } from "./servers.ts";

/** Telegram allows 10 rows under a message: Valider, then at most 9 machines. */
export const PLAN_MAX_MACHINES = 9;
const DATA = /^m:([vrxc]):(\d{1,12})(?::(\d{1,2}))?:([0-9a-f]{16})$/;

interface Tap {
  readonly planId: number;
  readonly token: string;
}
export type PlanPressed =
  | (Tap & { readonly kind: "valider" })
  | (Tap & { readonly kind: "confirmer" })
  | (Tap & { readonly kind: "retirer_reboot"; readonly machine: number })
  | (Tap & { readonly kind: "retirer"; readonly machine: number });

export function parsePlanPressed(data: string | undefined): PlanPressed | null {
  const m = DATA.exec(data ?? "");
  if (m === null) return null;
  const [, code, id, machine, token = ""] = m;
  const planId = Number(id);
  if (!Number.isSafeInteger(planId) || planId <= 0) return null;
  if (code === "v" || code === "c") {
    if (machine !== undefined) return null;
    return code === "v" ? { kind: "valider", planId, token } : { kind: "confirmer", planId, token };
  }
  if (machine === undefined) return null;
  const index = Number(machine);
  return code === "r"
    ? { kind: "retirer_reboot", planId, machine: index, token }
    : { kind: "retirer", planId, machine: index, token };
}

export interface PlanStepView {
  readonly host: string;
  readonly action: ServerActionName;
  readonly conditional: boolean;
  /** In the store, "attente" until run; a summary's fresh plan has no state yet. */
  readonly state?: string;
}
export interface PlanMachine {
  /** Its place among the plan's machines, stable whatever I remove. */
  readonly index: number;
  readonly name: string;
  /** Still in the plan: at least one step to do. */
  readonly kept: boolean;
  /** A reboot still in the plan. */
  readonly reboot: boolean;
}

const toDo = (s: PlanStepView) => s.state === undefined || s.state === "attente";

/** The plan's machines, in the order of their steps. */
export function planMachines(steps: readonly PlanStepView[]): PlanMachine[] {
  const names = [...new Set(steps.map((s) => s.host))];
  return names.map((name, index) => {
    const own = steps.filter((s) => s.host === name && toDo(s));
    return {
      index,
      name,
      kept: own.length > 0,
      reboot: own.some((s) => s.action === "redemarrer"),
    };
  });
}

/** The summary's buttons: Valider, then each machine still in the plan (at most 9). */
export function planKeyboard(
  planId: number,
  token: string,
  machines: readonly PlanMachine[],
): { text: string; data: string }[][] {
  const rows = [[{ text: "✅ Valider le plan", data: `m:v:${planId}:${token}` }]];
  for (const m of machines.filter((x) => x.kept).slice(0, PLAN_MAX_MACHINES)) {
    const row: { text: string; data: string }[] = [];
    if (m.reboot) {
      row.push({ text: `Retirer 🔄 de ${m.name}`, data: `m:r:${planId}:${m.index}:${token}` });
    }
    row.push({ text: `Retirer ${m.name}`, data: `m:x:${planId}:${m.index}:${token}` });
    rows.push(row);
  }
  return rows;
}

export function confirmPlanKeyboard(
  planId: number,
  token: string,
): { text: string; data: string }[][] {
  return [[{ text: "✅ Confirmer (2 min)", data: `m:c:${planId}:${token}` }]];
}

const ICON = { maj_securite: "⬆", services: "🔁", redemarrer: "🔄" } as const;

/** The question before my confirmation: exactly what will run, machine by machine. */
export function planPrompt(planId: number, steps: readonly PlanStepView[]): string {
  const lines = planMachines(steps)
    .filter((m) => m.kept)
    .map((m) => {
      const own = steps.filter((s) => s.host === m.name && toDo(s));
      const said = own.map((s) => `${ICON[s.action]}${s.conditional ? " s'il le faut" : ""}`);
      return `• ${m.name} : ${said.join(", puis ")}`;
    });
  return [
    `Confirmer le plan n°${planId} ? Dans cet ordre, une étape à la fois, chacune revérifiée et prouvée :`,
    ...lines,
    "Au premier accroc, tout s'arrête. Bouton valable 2 minutes.",
  ].join("\n");
}

/** What a tap answers (Telegram shows it briefly). */
export const PLAN_ANSWER = {
  asked: "Plan à confirmer : le bouton est sous ma question, valable 2 minutes.",
  nothing: "Plus rien dans ce plan : il n'y a rien à valider.",
  removedReboot: (host: string) => `🔄 retiré de ${host}.`,
  removed: (host: string) => `${host} retirée du plan.`,
  confirmed: "Plan confirmé : l'opérateur commence dans la minute (le Mac doit rester allumé).",
  expired: "Délai de 2 minutes dépassé : rappuie sur ✅ Valider le plan.",
  already: "Ce plan est déjà confirmé.",
  busy: "Un plan tourne déjà : celui-ci attendra le prochain récapitulatif.",
  stale: "Ce bouton n'est plus valable (plan remplacé ou déjà traité).",
  off: "Le plan de maintenance ou les actions sur les serveurs sont coupés (securite.toml).",
} as const;
