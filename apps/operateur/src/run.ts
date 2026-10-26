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
import type { Journal, ServeurActions, StoredServerAction, Verified } from "@cenacle/journal";
import {
  answerOf,
  hostState,
  motifCount,
  motifPresent,
  type Observation,
  SERVER_CATALOGUE,
  type ServersConfig,
  type ServersConfigProblem,
  sparedOf,
  sshArgs,
  verdictInstant,
} from "@cenacle/securite";
import { message } from "./messages.ts";

export { message };

const AGENT = "operateur";
/**
 * Older than this, a verdict proves nothing about now. Legion's ronde runs
 * every 15 minutes and the Mac copies its verdict every 15 minutes: the copy
 * is up to ~30 minutes old in ordinary times — 35 leaves a margin, and stays
 * stricter than the security agent's 45 (revised 2026-10-11, from 20).
 */
export const FRESH_VERDICT_MS = 35 * 60_000;
const AHEAD_MS = 5 * 60_000;
/** A machine rebooted by Cénacle is not rebooted again within this (the script refuses too). */
export const REBOOT_GAP_MS = 24 * 3_600_000;
/** A reboot's proof: a verdict written at least this long after it… */
export const BACK_AFTER_MS = 3 * 60_000;
/** …and without one showing the machine back by then, it is said loud, once. */
export const NOT_BACK_MS = 30 * 60_000;
/** Security updates run in the background: no proof before this… */
export const UPDATE_PROOF_AFTER_MS = 10 * 60_000;
/** …and still pending this long after: said, to look at. */
export const UPDATE_GIVE_UP_MS = 2 * 3_600_000;

export interface OperatorDeps {
  readonly store: Pick<
    ServeurActions,
    | "expire"
    | "abandonStale"
    | "next"
    | "claim"
    | "doneSince"
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
  /** serveurs.local.toml, or what is wrong with it. */
  readonly config: ServersConfig | ServersConfigProblem;
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

async function record(deps: OperatorDeps, payload: Record<string, string>): Promise<void> {
  await deps.journal.append({ agent: AGENT, type: "serveur.action", payload });
}

/** Checks again before acting; the refusal's name, or null when all holds. */
async function whyNot(
  deps: OperatorDeps,
  a: StoredServerAction,
  nowMs: number,
): Promise<string | null> {
  if (!deps.active) return "interrupteur";
  if (typeof deps.config === "string") return `config_${deps.config}`;
  const server = deps.config.servers.find((s) => s.name === a.host);
  if (server === undefined) return "machine_inconnue";
  const key = server.keys[a.action];
  if (key === undefined) return "pas_de_cle";
  if (!deps.keyIsPrivate(key)) return "cle_mal_protegee";
  if (
    a.action === "redemarrer" &&
    (await deps.store.doneSince(a.host, "redemarrer", new Date(nowMs - REBOOT_GAP_MS)))
  ) {
    return "redemarrage_recent";
  }
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
  const refusal = await whyNot(deps, a, now.getTime());
  if (refusal !== null) {
    await deps.store.refuse(a.id, refusal, now);
    await record(deps, { action: a.action, outcome: "refusee", refusal });
    return { ran: 0, refused: 1 };
  }
  // Another action running on any machine: this one waits for the next minute.
  if (!(await deps.store.claim(a.id, now))) return { ran: 0, refused: 0 };
  const config = typeof deps.config === "string" ? null : deps.config;
  const server = config?.servers.find((s) => s.name === a.host);
  const key = server?.keys[a.action];
  if (server === undefined || key === undefined || config === null) {
    throw new Error("the checked server vanished");
  }
  // What Legion counted before, so the proof can tell "fewer" from "still there".
  const raw = deps.verdict();
  let before: number | null = null;
  try {
    before =
      raw === null
        ? null
        : motifCount(
            deps.parseVerdict(raw, now.getTime()),
            a.host,
            SERVER_CATALOGUE[a.action].finding,
          );
  } catch {
    before = null;
  }
  const code = await deps.ssh(sshArgs(server, key, config.knownHosts));
  const { outcome } = answerOf(a.action, code);
  await deps.store.finish(a.id, outcome, code, deps.now(), before);
  await record(deps, { action: a.action, outcome });
  return { ran: 1, refused: 0 };
}

/**
 * What a verdict says of a done action: services — gone or still there, once
 * the verdict is later than the action; a reboot — back (not MALADE) and no
 * reboot required, from 3 minutes on; not seen back 30 minutes on: said loud;
 * security updates — gone from 10 minutes on, still pending 2 hours on: said.
 * Services fewer than before but not none: "reduit" — the spared ones remain;
 * no more than the script said it spared: "epargnes" — only they remain
 * (ADR-0035, point 7).
 */
function proof(
  a: StoredServerAction,
  raw: string | null,
  at: number | null,
  seen: Observation[] | null,
  nowMs: number,
): { verified: Verified; after: number | null } | null {
  const verified = proved(a, raw, at, seen, nowMs);
  if (verified === null) return null;
  const after = seen === null ? null : motifCount(seen, a.host, SERVER_CATALOGUE[a.action].finding);
  if (verified === "toujours_la" && a.action === "services") {
    const spared = sparedOf(a.action, a.exitCode);
    if (spared !== null && after !== null && after <= spared)
      return { verified: "epargnes", after };
    const fewer = a.beforeCount !== null && after !== null && after < a.beforeCount;
    return { verified: fewer ? "reduit" : "toujours_la", after };
  }
  return { verified, after };
}

function proved(
  a: StoredServerAction,
  raw: string | null,
  at: number | null,
  seen: Observation[] | null,
  nowMs: number,
): Verified | null {
  const finished = a.finishedAt?.getTime() ?? null;
  if (finished === null) return null;
  const finding = SERVER_CATALOGUE[a.action].finding;
  if (a.action === "maj_securite") {
    if (raw === null || at === null || seen === null) return null;
    if (at < finished + UPDATE_PROOF_AFTER_MS) return null;
    if (!motifPresent(seen, a.host, finding)) return "disparu";
    return nowMs - finished >= UPDATE_GIVE_UP_MS ? "toujours_la" : null;
  }
  if (a.action !== "redemarrer") {
    if (raw === null || at === null || seen === null || at <= finished) return null;
    return motifPresent(seen, a.host, finding) ? "toujours_la" : "disparu";
  }
  const usable = raw !== null && at !== null && seen !== null && at >= finished + BACK_AFTER_MS;
  if (usable && hostState(raw, a.host) !== "MALADE") {
    return motifPresent(seen, a.host, finding) ? "toujours_la" : "disparu";
  }
  return nowMs - finished >= NOT_BACK_MS ? "pas_revenue" : null;
}

async function verify(deps: OperatorDeps): Promise<number> {
  const pending = await deps.store.toVerify();
  if (pending.length === 0) return 0;
  const nowMs = deps.now().getTime();
  const raw = deps.verdict();
  const at = raw === null ? null : verdictInstant(raw);
  let seen: Observation[] | null = null;
  if (raw !== null) {
    try {
      seen = deps.parseVerdict(raw, nowMs);
    } catch {
      seen = null;
    }
  }
  let done = 0;
  for (const a of pending) {
    const found = proof(a, raw, at, seen, nowMs);
    if (found === null) continue;
    if (await deps.store.verify(a.id, found.verified, deps.now(), found.after)) {
      await record(deps, { action: a.action, outcome: found.verified });
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
