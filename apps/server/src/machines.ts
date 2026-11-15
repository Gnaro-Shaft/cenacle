/**
 * The machines' bulletins for the Parc tab (ADR-0039): one ssh call per
 * machine, with its read-only key locked on cenacle-bulletin, the server's
 * fingerprint pinned (StrictHostKeyChecking), a short environment, a short
 * time limit, a capped output. One reading at a time, kept 30 s: the page
 * asks every minute, never more. Nothing is kept beyond that.
 *
 * A machine that does not answer is "injoignable"; one that answers out of
 * shape is "illisible" — never shown as healthy, never half shown.
 */
import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import {
  asServer,
  type Bulletin,
  MAX_BULLETIN,
  type ParkConfig,
  parseBulletin,
  parseParkMachines,
  sshArgs,
} from "@cenacle/securite";

export const SSH = "/usr/bin/ssh";
const SSH_TIMEOUT_MS = 20_000;
const KEEP_MS = 30_000;

/** What the page is given of a bulletin: its measures, nothing the ronde judges. */
export type BulletinMeasures = Omit<Bulletin, "version" | "health">;

/**
 * The measures only (ADR-0040, R1): the facts a version 2 bulletin adds —
 * ports, updates, quorum — are for the ronde, never sent to the browser.
 * Picked field by field, so that a field added to Bulletin stays out until
 * someone decides the page should show it.
 */
export function measuresOnly(b: Bulletin): BulletinMeasures {
  return {
    host: b.host,
    at: b.at,
    uptimeSeconds: b.uptimeSeconds,
    load: b.load,
    cpus: b.cpus,
    memory: b.memory,
    disks: b.disks,
  };
}

export type MachineRead =
  | { readonly name: string; readonly read: "ok"; readonly bulletin: BulletinMeasures }
  | { readonly name: string; readonly read: "injoignable" | "illisible" | "cle" };

export interface MachinesView {
  /** parc.local.toml: absent (no machine to read), unreadable, or read. */
  readonly config: "absent" | "illisible" | "ok";
  readonly machines: readonly MachineRead[];
}

/** One call: its exit code (-1 when cut off) and its output, capped. */
export type Run = (args: readonly string[]) => Promise<{ code: number; out: string }>;

export const runSsh: Run = (args) =>
  new Promise((resolve) => {
    execFile(
      SSH,
      [...args],
      {
        timeout: SSH_TIMEOUT_MS,
        maxBuffer: MAX_BULLETIN,
        env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME ?? "", LANG: "C" },
      },
      (error, stdout) => {
        const out = typeof stdout === "string" ? stdout : "";
        if (error === null) resolve({ code: 0, out });
        // Cut off by the limit, or by maxBuffer: no answer worth reading.
        else if (error.killed === true || error.signal !== null) resolve({ code: -1, out: "" });
        else resolve({ code: typeof error.code === "number" ? error.code : -1, out: "" });
      },
    );
  });

/** A regular file of mine, readable by me only (600 or 400): else the key is not used. */
export function keyIsPrivate(path: string, uid = process.getuid?.() ?? -1): boolean {
  try {
    const s = statSync(path);
    return s.isFile() && (s.mode & 0o077) === 0 && s.uid === uid;
  } catch {
    return false;
  }
}

export interface MachinesDeps {
  /** The text of parc.local.toml, or null when it is absent. */
  readonly readConfig: () => string | null;
  readonly run: Run;
  readonly keyOk: (path: string) => boolean;
  readonly now: () => number;
}

/** parc.local.toml in `root`: null when absent; any other failure is thrown. */
export function configFile(path: string): () => string | null {
  return () => {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return null;
      throw error;
    }
  };
}

async function readOne(config: ParkConfig, i: number, deps: MachinesDeps): Promise<MachineRead> {
  const machine = config.machines[i];
  if (machine === undefined) throw new Error("no such machine");
  const { name } = machine;
  if (!deps.keyOk(machine.key)) return { name, read: "cle" };
  const { code, out } = await deps.run(sshArgs(asServer(machine), machine.key, config.knownHosts));
  if (code === 255 || code === -1) return { name, read: "injoignable" };
  if (code !== 0) return { name, read: "illisible" };
  try {
    return { name, read: "ok", bulletin: measuresOnly(parseBulletin(out)) };
  } catch {
    return { name, read: "illisible" };
  }
}

export function createMachines(deps: MachinesDeps): () => Promise<MachinesView> {
  let kept: { at: number; view: Promise<MachinesView> } | null = null;
  const readAll = async (): Promise<MachinesView> => {
    let text: string | null;
    try {
      text = deps.readConfig();
    } catch {
      return { config: "illisible", machines: [] };
    }
    if (text === null) return { config: "absent", machines: [] };
    let config: ParkConfig;
    try {
      config = parseParkMachines(text);
    } catch {
      return { config: "illisible", machines: [] };
    }
    const machines = await Promise.all(config.machines.map((_, i) => readOne(config, i, deps)));
    return { config: "ok", machines };
  };
  return () => {
    const now = deps.now();
    // One reading at a time, kept 30 s: a page refreshed often never multiplies the calls.
    if (kept === null || now - kept.at > KEEP_MS) kept = { at: now, view: readAll() };
    return kept.view;
  };
}
