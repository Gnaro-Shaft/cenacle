/**
 * One pass of the operator (J6f, ADR-0027), every minute: expire what I did
 * not confirm in time; free a run cut off midway; take the oldest confirmed
 * request and, before acting, check everything again — the switch, the
 * machine, its key, a verdict of Legion under 35 minutes that still shows
 * the problem (charter, rule 5); then one fixed ssh call, whose exit code
 * alone is read. A later verdict tells whether the problem went away. Every
 * outcome is told to me once the message has left, and journaled as counts.
 * No model anywhere.
 */
import type { Journal, ServeurActions, StoredServerAction } from "@cenacle/journal";
import {
  motifPresent,
  type Observation,
  outcomeOf,
  SERVER_CATALOGUE,
  type ServersConfig,
  sshArgs,
  verdictInstant,
} from "@cenacle/securite";

const AGENT = "operateur";
/**
 * Older than this, a verdict proves nothing about now. Legion's ronde runs
 * every 15 minutes and the Mac copies its verdict every 15 minutes: the copy
 * is up to ~30 minutes old in ordinary times — 35 leaves a margin, and stays
 * stricter than the security agent's 45 (revised 2026-10-11, from 20).
 */
export const FRESH_VERDICT_MS = 35 * 60_000;
const AHEAD_MS = 5 * 60_000;

export interface OperatorDeps {
  readonly store: Pick<
    ServeurActions,
    | "expire"
    | "abandonStale"
    | "next"
    | "claim"
    | "refuse"
    | "finish"
    | "toVerify"
    | "verify"
    | "toTell"
    | "markTold"
    | "purge"
  >;
  /** `[serveurs] actif` of securite.toml. */
  readonly active: boolean;
  /** serveurs.local.toml; null when it is absent or unreadable. */
  readonly config: ServersConfig | null;
  /** Legion's raw verdict, or null when it cannot be read. */
  readonly verdict: () => string | null;
  /** The verdict's findings; throws when it is not a valid, fresh verdict. */
  readonly parseVerdict: (raw: string, nowMs: number) => Observation[];
  readonly keyIsPrivate: (path: string) => boolean;
  readonly ssh: (args: readonly string[]) => Promise<number>;
  readonly send: (text: string) => Promise<void>;
  readonly journal: Pick<Journal, "append">;
  readonly now: () => Date;
}

export interface OperatorOutcome {
  readonly ran: number;
  readonly refused: number;
  readonly verified: number;
  readonly told: number;
}

const REFUSAL: Readonly<Record<string, string>> = {
  interrupteur: "les actions sur les serveurs sont coupées ([serveurs] actif dans securite.toml)",
  configuration: "serveurs.local.toml est absent ou illisible",
  machine_inconnue: "cette machine n'est pas déclarée dans serveurs.local.toml",
  pas_de_cle: "aucune clé n'est déclarée pour cette action sur cette machine",
  cle_mal_protegee: "sa clé est lisible par un autre que toi (chmod 600)",
  releve_perime: "le relevé de Legion a plus de 35 minutes : rien n'est sûr",
  releve_illisible: "le relevé de Legion est illisible",
  plus_de_motif: "le dernier relevé de Legion ne montre plus le problème : rien à faire",
};

/** What I read on Telegram: the machine, the finding, the outcome — never a server's output. */
export function message(a: StoredServerAction): string {
  const on = `${a.host} (constat n°${a.findingId})`;
  switch (a.state) {
    case "faite":
      if (a.verified === "disparu")
        return `✅ ${on} : le relevé de Legion ne montre plus le problème, l'action a pris.`;
      if (a.verified === "toujours_la")
        return `⚠ ${on} : le relevé de Legion montre encore le problème — à regarder sur la machine (journalctl -t cenacle).`;
      return `🔁 ${on} : ${SERVER_CATALOGUE[a.action].label}, fait. J'attends le prochain relevé de Legion pour le confirmer.`;
    case "rien_a_faire":
      return `🔁 ${on} : rien à faire — le script n'a trouvé aucun service à relancer hors de ses exclusions.`;
    case "refusee_serveur":
      return `🛑 ${on} : un garde-fou du serveur a refusé, rien n'a été fait (journalctl -t cenacle sur la machine).`;
    case "refusee":
      return `🛑 ${on} : rien n'a été fait — ${REFUSAL[a.refusal ?? ""] ?? "refus de l'opérateur"}.`;
    case "expiree":
      return `⌛ ${on} : demande non confirmée dans les 2 minutes, rien n'a été fait.`;
    case "echouee":
      if (a.exitCode === 255)
        return `🛑 ${on} : serveur injoignable ou clé refusée — rien n'est sûr, à vérifier.`;
      if (a.exitCode === -1)
        return `🛑 ${on} : l'action a été coupée en cours — état inconnu, à vérifier sur la machine.`;
      return `🛑 ${on} : l'action a échoué (code ${a.exitCode ?? "?"}) — journalctl -t cenacle sur la machine.`;
    default:
      return `${on} : ${a.state}`;
  }
}

async function record(deps: OperatorDeps, payload: Record<string, string>): Promise<void> {
  await deps.journal.append({ agent: AGENT, type: "serveur.action", payload });
}

/** Checks again before acting; the refusal's name, or null when all holds. */
function whyNot(deps: OperatorDeps, a: StoredServerAction, nowMs: number): string | null {
  if (!deps.active) return "interrupteur";
  if (deps.config === null) return "configuration";
  const server = deps.config.servers.find((s) => s.name === a.host);
  if (server === undefined) return "machine_inconnue";
  const key = server.keys[a.action];
  if (key === undefined) return "pas_de_cle";
  if (!deps.keyIsPrivate(key)) return "cle_mal_protegee";
  const raw = deps.verdict();
  const at = raw === null ? null : verdictInstant(raw);
  if (raw === null || at === null || nowMs - at > FRESH_VERDICT_MS || at - nowMs > AHEAD_MS) {
    return "releve_perime";
  }
  let seen: Observation[];
  try {
    seen = deps.parseVerdict(raw, nowMs);
  } catch {
    return "releve_illisible";
  }
  return motifPresent(seen, a.host, SERVER_CATALOGUE[a.action].finding) ? null : "plus_de_motif";
}

async function act(deps: OperatorDeps): Promise<{ ran: number; refused: number }> {
  const a = await deps.store.next();
  if (a === null) return { ran: 0, refused: 0 };
  const now = deps.now();
  const refusal = whyNot(deps, a, now.getTime());
  if (refusal !== null) {
    await deps.store.refuse(a.id, refusal, now);
    await record(deps, { action: a.action, outcome: "refusee", refusal });
    return { ran: 0, refused: 1 };
  }
  // Another action running on any machine: this one waits for the next minute.
  if (!(await deps.store.claim(a.id, now))) return { ran: 0, refused: 0 };
  const server = deps.config?.servers.find((s) => s.name === a.host);
  const key = server?.keys[a.action];
  if (server === undefined || key === undefined || deps.config === null) {
    throw new Error("the checked server vanished");
  }
  const code = await deps.ssh(sshArgs(server, key, deps.config.knownHosts));
  const outcome = outcomeOf(code);
  await deps.store.finish(a.id, outcome, code, deps.now());
  await record(deps, { action: a.action, outcome });
  return { ran: 1, refused: 0 };
}

/** A done action against a verdict written after it: did the problem go away? */
async function verify(deps: OperatorDeps): Promise<number> {
  const pending = await deps.store.toVerify();
  if (pending.length === 0) return 0;
  const raw = deps.verdict();
  const at = raw === null ? null : verdictInstant(raw);
  if (raw === null || at === null) return 0;
  let seen: Observation[];
  try {
    seen = deps.parseVerdict(raw, deps.now().getTime());
  } catch {
    return 0;
  }
  let done = 0;
  for (const a of pending) {
    if (a.finishedAt === null || at <= a.finishedAt.getTime()) continue;
    const still = motifPresent(seen, a.host, SERVER_CATALOGUE[a.action].finding);
    if (await deps.store.verify(a.id, still ? "toujours_la" : "disparu", deps.now())) {
      await record(deps, { action: a.action, outcome: still ? "toujours_la" : "disparu" });
      done += 1;
    }
  }
  return done;
}

export async function runOperator(deps: OperatorDeps): Promise<OperatorOutcome> {
  const now = deps.now();
  await deps.store.expire(now);
  await deps.store.abandonStale(now);
  const { ran, refused } = await act(deps);
  const verified = await verify(deps);
  let told = 0;
  for (const a of await deps.store.toTell()) {
    // Told once it has left: a message that fails goes again at the next pass.
    await deps.send(message(a));
    await deps.store.markTold([a.id]);
    told += 1;
  }
  await deps.store.purge(deps.now());
  return { ran, refused, verified, told };
}
