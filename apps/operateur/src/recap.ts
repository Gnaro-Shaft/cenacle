/**
 * The maintenance summary, sent by the operator (J7c, ADR-0035): from 9:00
 * once a day, and within a minute of my /maintenance. It asks nothing of a
 * server and decides nothing: when there is something to do, it proposes
 * the plan its lines describe, with ✅ Valider and "Retirer" under it (J7d);
 * my taps and my confirmation are the bot's. No plan while one runs, nor
 * while the actions on the servers are off. Told only once the message has
 * left (a failed send is tried again at the next pass; the plan it had
 * proposed is replaced), then journaled as counts.
 */
import type { Journal, PlanStore, StoredFinding } from "@cenacle/journal";
import {
  formatRecap,
  type LastRestart,
  NOTHING_TO_DO,
  planKeyboard,
  planMachines,
  recapDue,
  type ServerActionName,
  type ServersConfig,
  type ServersConfigProblem,
} from "@cenacle/securite";

export interface RecapDeps {
  /** `[maintenance] actif` of securite.toml. */
  readonly active: boolean;
  /** `[serveurs] actif`: said in the summary when off. */
  readonly serversActive: boolean;
  readonly config: ServersConfig | ServersConfigProblem;
  readonly findings: () => Promise<readonly StoredFinding[]>;
  readonly lastRestarts: () => Promise<ReadonlyMap<string, LastRestart>>;
  /** The last morning summary, the last of any kind, my last /maintenance. */
  readonly last: () => Promise<{ morning: Date | null; any: Date | null; asked: Date | null }>;
  readonly send: (text: string) => Promise<void>;
  /** A message with buttons under it; returns its id (J7d). */
  readonly sendWithButtons: (
    text: string,
    rows: readonly (readonly { text: string; callback_data: string }[])[],
  ) => Promise<number>;
  readonly plans: Pick<PlanStore, "propose" | "setMessage" | "running">;
  readonly journal: Pick<Journal, "append">;
  readonly now: () => Date;
}

/** Sends the summary when due; 1 when a message left, else 0. */
export async function runRecap(deps: RecapDeps): Promise<number> {
  if (!deps.active) return 0;
  const now = deps.now();
  const why = recapDue(now, await deps.last());
  if (why === null) return 0;
  const record = (machines: number, steps: number) =>
    deps.journal.append({
      agent: "operateur",
      type: "maintenance.recap",
      payload: { quand: why, machines, etapes: steps },
    });
  if (typeof deps.config === "string") {
    // Never a silent morning: the list it needs is unusable, said by its kind.
    await deps.send(
      `🧰 Récapitulatif de maintenance impossible : serveurs.local.toml ne se lit pas (${deps.config}) — détail : npm run serveurs:verifier.`,
    );
    await record(0, 0);
    return 1;
  }
  const recap = formatRecap({
    machines: deps.config.servers.map((s) => ({
      name: s.name,
      actions: Object.keys(s.keys) as ServerActionName[],
    })),
    findings: await deps.findings(),
    lastRestart: await deps.lastRestarts(),
    serversActive: deps.serversActive,
    now,
  });
  if (recap.text === null && why === "matin") {
    // Nothing to do: no message, but the morning counts as done.
    await record(0, 0);
    return 0;
  }
  if (recap.text === null) {
    // Asked with nothing to do: said so, with what stays for memory.
    await deps.send([NOTHING_TO_DO, recap.memo].filter((x) => x !== null).join("\n\n"));
    await record(0, 0);
    return 1;
  }
  const running = recap.plan.length > 0 ? await deps.plans.running() : null;
  if (recap.plan.length === 0 || !deps.serversActive || running !== null) {
    const why =
      recap.plan.length === 0
        ? "Rien à valider ici : ce qui reste se fait à la main (chaque constat garde ses boutons, /constats)."
        : running !== null
          ? `Le plan n°${running.id} tourne encore : pas de bouton ici, le prochain récapitulatif proposera la suite.`
          : "Pas de plan tant que les actions sur les serveurs sont coupées.";
    await deps.send(`${recap.text}\n\n${why}`);
    await record(recap.machines, recap.steps);
    return 1;
  }
  const plan = await deps.plans.propose(recap.plan, now);
  const rows = planKeyboard(plan.id, plan.token, planMachines(recap.plan)).map((row) =>
    row.map((b) => ({ text: b.text, callback_data: b.data })),
  );
  const messageId = await deps.sendWithButtons(
    `${recap.text}\n\n✅ Valider le plan lance ces étapes une à une, chacune revérifiée et prouvée, après ta confirmation. « Retirer » enlève un redémarrage ou une machine.`,
    rows,
  );
  await deps.plans.setMessage(plan.id, messageId);
  await record(recap.machines, recap.steps);
  return 1;
}
