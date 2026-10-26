/**
 * The maintenance summary, sent by the operator (J7c, ADR-0035): from 9:00
 * once a day, and within a minute of my /maintenance. Read only: it asks
 * nothing of a server, holds no button, decides nothing. Told only once the
 * message has left (a failed send is tried again at the next pass), then
 * journaled as counts.
 */
import type { Journal, StoredFinding } from "@cenacle/journal";
import {
  formatRecap,
  type LastRestart,
  NOTHING_TO_DO,
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
  // Asked with nothing to do: said so, with what stays for memory.
  await deps.send(recap.text ?? [NOTHING_TO_DO, recap.memo].filter((x) => x !== null).join("\n\n"));
  await record(recap.machines, recap.steps);
  return 1;
}
