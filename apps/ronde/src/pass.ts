/**
 * One pass of the ronde (ADR-0040, R2): each machine of parc.local.toml read
 * with its read-only key, all at once, each judged on its own — one that
 * fails never holds the others back, and is MALADE with the reason, never
 * SAIN. Out: the verdict's hosts, in the file's order, and the measures for
 * the page. Pure but for what is injected: the file, ssh, the key check, the clock.
 */
import {
  asServer,
  BulletinError,
  backupJudgments,
  failureVerdict,
  fileBackups,
  judge,
  type MachineRead,
  type MachineUnread,
  measuresOnly,
  type NamedVerdict,
  type ParkConfig,
  type ParkMachine,
  parseBulletin,
  parseParkMachines,
  type RondeBulletins,
  type RondeFailure,
  sshArgs,
} from "@cenacle/securite";
import type { Run } from "./ssh.ts";

export interface PassDeps {
  /** parc.local.toml's text, or null when it is absent; throws when it cannot be read. */
  readonly readConfig: () => string | null;
  readonly run: Run;
  readonly keyOk: (path: string) => boolean;
  readonly now: () => number;
}

export interface PassResult {
  /** Empty when there is no machine to judge: no verdict is written then. */
  readonly hosts: readonly NamedVerdict[];
  readonly bulletins: RondeBulletins;
  /** Why each machine that failed did, for the log: no address, no ssh output. */
  readonly notes: readonly string[];
}

interface One {
  readonly verdict: NamedVerdict;
  readonly read: MachineRead;
  readonly note: string | null;
}

function failed(
  machine: ParkMachine,
  read: MachineUnread,
  failure: RondeFailure,
  note: string,
  code = 0,
): One {
  const { name } = machine;
  return {
    verdict: { name, ...failureVerdict(name, failure, code) },
    // What it expects stays said: its backups are unknown, never healthy.
    read: { name, read, declared: machine.expect.backups },
    note: `${name}: ${note}`,
  };
}

async function readOne(machine: ParkMachine, config: ParkConfig, deps: PassDeps): Promise<One> {
  const { name } = machine;
  if (!deps.keyOk(machine.key)) return failed(machine, "cle", "cle", "key not private (600)");
  const { code, out } = await deps.run(sshArgs(asServer(machine), machine.key, config.knownHosts));
  if (code === -1) return failed(machine, "injoignable", "delai", "cut off");
  if (code === -2) return failed(machine, "illisible", "lancement", "ssh could not start");
  if (code === 255) return failed(machine, "injoignable", "ssh", "ssh 255", code);
  if (code !== 0) return failed(machine, "illisible", "ssh", `exit ${code}`, code);
  let bulletin: ReturnType<typeof parseBulletin>;
  try {
    bulletin = parseBulletin(out);
  } catch (error) {
    if (!(error instanceof BulletinError)) throw error;
    // The reason may quote 40 characters of the machine's own: kept to plain ones.
    const reason = error.message.replace(/[^\w .:=/-]/g, "?").slice(0, 120);
    return failed(machine, "illisible", "illisible", reason);
  }
  const verdict = { name, ...judge(name, bulletin, machine.expect, deps.now()) };
  // Another machine's bulletin: judged MALADE, and its measures are not this machine's.
  const { hostname } = machine.expect;
  if (hostname !== null && bulletin.host !== hostname) {
    return {
      verdict,
      read: { name, read: "autre-hote", declared: machine.expect.backups },
      note: `${name}: another host's bulletin`,
    };
  }
  const declared = machine.expect.backups;
  const judged = backupJudgments(bulletin, declared);
  return {
    verdict,
    read: {
      name,
      read: "ok",
      bulletin: measuresOnly(bulletin),
      declared,
      backups: judged === null ? null : fileBackups(judged),
    },
    note: null,
  };
}

export async function runPass(deps: PassDeps): Promise<PassResult> {
  const empty = (state: RondeBulletins["config"], note: string): PassResult => ({
    hosts: [],
    bulletins: { at: deps.now(), config: state, machines: [] },
    notes: [note],
  });
  let text: string | null;
  try {
    text = deps.readConfig();
  } catch {
    return empty("illisible", "parc.local.toml cannot be read");
  }
  if (text === null) return empty("absent", "no parc.local.toml: no machine to read");
  let config: ParkConfig;
  try {
    config = parseParkMachines(text);
  } catch (error) {
    return empty("illisible", (error as Error).message);
  }
  if (config.machines.length === 0) return empty("ok", "parc.local.toml names no machine");
  const all = await Promise.all(config.machines.map((m) => readOne(m, config, deps)));
  return {
    hosts: all.map((o) => o.verdict),
    bulletins: { at: deps.now(), config: "ok", machines: all.map((o) => o.read) },
    notes: all.flatMap((o) => (o.note === null ? [] : [o.note])),
  };
}
