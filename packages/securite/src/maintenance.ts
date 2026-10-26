/**
 * The maintenance summary (J7c, ADR-0035): once a day from 9:00, and on my
 * /maintenance, one message saying, machine by machine, what its open server
 * findings call for — ⬆ the security updates, 🔁 the services, 🔄 the reboot.
 * A table in the code decides the steps, never a model (charter, rule 1).
 * No button yet: the findings keep theirs. Built by the operator, the only
 * program that reads serveurs.local.toml (ADR-0027): the machines' order is
 * its blocks', and a step without a key is said "by hand".
 */
import { parse } from "smol-toml";
import { dueOnceADay } from "./cadence.ts";
import { TELEGRAM_MAX } from "./report.ts";
import { SERVER_CATALOGUE, type ServerActionName, sparedOf } from "./servers.ts";

export const RECAP_AT = { hour: 9, minute: 0 } as const;
/** A restart's spared count speaks for this long; then 🔁 is offered again, to look anew. */
export const SPARED_VALID_MS = 7 * 86_400_000;

/** `[maintenance] actif` of securite.toml: anything but `true` is off. */
export function parseMaintenanceSwitch(text: string): boolean {
  try {
    const m = (parse(text) as Record<string, unknown>).maintenance;
    return (
      typeof m === "object" &&
      m !== null &&
      !Array.isArray(m) &&
      (m as { actif?: unknown }).actif === true
    );
  } catch {
    return false;
  }
}

/**
 * Why the summary goes now: my /maintenance came after the last one sent
 * (at any hour), or the morning one has not gone today. Null: not now.
 */
export function recapDue(
  now: Date,
  last: { readonly morning: Date | null; readonly any: Date | null; readonly asked: Date | null },
): "demande" | "matin" | null {
  if (last.asked !== null && (last.any === null || last.asked > last.any)) return "demande";
  return dueOnceADay(RECAP_AT, now, last.morning) ? "matin" : null;
}

export interface RecapMachine {
  readonly name: string;
  /** The actions it holds a key for (serveurs.local.toml). */
  readonly actions: readonly ServerActionName[];
}
export interface RecapFinding {
  readonly type: string;
  readonly target: string;
  readonly params: Readonly<Record<string, string>>;
}
export interface LastRestart {
  readonly exitCode: number;
  readonly finishedAt: Date;
}
export interface RecapInput {
  readonly machines: readonly RecapMachine[];
  /** The open findings; only the server ones count. */
  readonly findings: readonly RecapFinding[];
  /** The last restart of the services, by machine, when there was one. */
  readonly lastRestart: ReadonlyMap<string, LastRestart>;
  /** `[serveurs] actif`: off, no step can run, said once. */
  readonly serversActive: boolean;
  readonly now: Date;
}
export interface Recap {
  /** Null: nothing to do anywhere (a memo alone is not something to do). */
  readonly text: string | null;
  readonly machines: number;
  readonly steps: number;
  /** The spared ones left after a restart, said for memory — also when nothing is to do. */
  readonly memo: string | null;
}

const COUNT = /^\d{1,5}$/;
const count = (f: RecapFinding | undefined): number | null =>
  f !== undefined && COUNT.test(f.params.count ?? "") ? Number(f.params.count) : null;

interface Lines {
  readonly lines: string[];
  readonly steps: number;
  readonly memo: string | null;
}

function machineLines(m: RecapMachine, input: RecapInput): Lines {
  const of = (action: ServerActionName) =>
    input.findings.find((f) => f.target === m.name && f.type === SERVER_CATALOGUE[action].finding);
  const has = (action: ServerActionName) => m.actions.includes(action);
  const lines: string[] = [];
  let steps = 0;
  let memo: string | null = null;
  const step = (action: ServerActionName, text: string) => {
    if (has(action)) steps++;
    lines.push(has(action) ? text : `${text} — à faire à la main (aucune clé)`);
  };

  const update = of("maj_securite");
  if (update !== undefined) {
    const n = count(update);
    step("maj_securite", `⬆ mises à jour de sécurité${n === null ? "" : ` (${n} en attente)`}`);
  }
  const services = of("services");
  if (services !== undefined) {
    const n = count(services);
    const last = input.lastRestart.get(m.name);
    const spared =
      last !== undefined && input.now.getTime() - last.finishedAt.getTime() <= SPARED_VALID_MS
        ? sparedOf("services", last.exitCode)
        : null;
    if (spared !== null && n !== null && n <= spared) {
      memo = `${m.name} (${n})`;
    } else {
      step("services", `🔁 relancer les services${n === null ? "" : ` (${n})`}`);
    }
  } else if (update !== undefined && has("services")) {
    lines.push("🔁 s'il le faut, après la mise à jour");
  }
  if (of("redemarrer") !== undefined) {
    step(
      "redemarrer",
      "🔄 redémarrage demandé — refusé si des invités tournent : vider le nœud d'abord",
    );
  } else if (update !== undefined && has("redemarrer")) {
    lines.push("🔄 s'il le faut, après la mise à jour");
  }
  return { lines, steps, memo };
}

/** The summary's text, worst cut at Telegram's limit — or null when nothing is to do. */
export function formatRecap(input: RecapInput): Recap {
  const serverTypes = new Set(Object.values(SERVER_CATALOGUE).map((c) => c.finding));
  const known = new Set(input.machines.map((m) => m.name));
  const blocks: string[] = [];
  const memos: string[] = [];
  let steps = 0;
  for (const m of input.machines) {
    const l = machineLines(m, input);
    if (l.memo !== null) memos.push(l.memo);
    if (l.lines.length === 0) continue;
    steps += l.steps;
    blocks.push([`• ${m.name}`, ...l.lines.map((x) => `   ${x}`)].join("\n"));
  }
  const outside = [
    ...new Set(
      input.findings
        .filter((f) => serverTypes.has(f.type) && !known.has(f.target))
        .map((f) => f.target),
    ),
  ].sort();
  const memo =
    memos.length === 0
      ? null
      : `Pour mémoire, il ne reste que les services épargnés par principe : ${memos.join(", ")} — à la main, ou au prochain 🔄.`;
  if (blocks.length === 0 && outside.length === 0) {
    return { text: null, machines: 0, steps: 0, memo };
  }
  const parts = ["🧰 Maintenance à faire", ...blocks];
  if (outside.length > 0) parts.push(`Hors Cénacle, à la main : ${outside.join(", ")}.`);
  if (memo !== null) parts.push(memo);
  if (!input.serversActive) {
    parts.push(
      "⚠ Les actions sur les serveurs sont coupées ([serveurs] actif dans securite.toml).",
    );
  }
  parts.push("Pas encore de bouton ici : chaque constat garde les siens (/constats).");
  return { text: fit(parts), machines: blocks.length, steps, memo };
}

/** Whole parts while they fit; the rest said by its count. */
function fit(parts: readonly string[]): string {
  const all = parts.join("\n\n");
  if (all.length <= TELEGRAM_MAX) return all;
  const kept: string[] = [];
  for (const p of parts) {
    const next = [...kept, p].join("\n\n");
    if (next.length > TELEGRAM_MAX - 80) break;
    kept.push(p);
  }
  return `${kept.join("\n\n")}\n\n… (${parts.length - kept.length} partie(s) de plus : /constats)`;
}

/** When nothing is to do: the summary I asked for still answers. */
export const NOTHING_TO_DO = "🧰 Rien à faire sur les serveurs.";
