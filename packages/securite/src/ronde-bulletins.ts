/**
 * The last bulletins, as the ronde leaves them for the page (ADR-0040, R2):
 * the measures only — never what the ronde judges (ports, updates, quorum)
 * but the backups (ADR-0043, S2b: ronde-bulletins-backups.ts) — for each
 * machine of parc.local.toml, or why it could not be read. The
 * ronde writes the file whole at every pass; the page reads it back here,
 * as strictly as any input: a file out of shape is unreadable, never half shown.
 */
import type { Bulletin } from "./bulletin.ts";
import type { BackupSource } from "./bulletin-backups.ts";
import { backupsOf, declaredOf, type FileBackup } from "./ronde-bulletins-backups.ts";

/** Where the ronde leaves the last bulletins, overwritten at every pass. */
export const RONDE_BULLETINS_PATH =
  process.env.RONDE_BULLETINS_PATH ??
  `${process.env.HOME ?? ""}/Library/Caches/fr.gnaro.cenacle.ronde.bulletins.json`;

/** A few kilobytes per machine: anything larger is not the ronde's. */
export const MAX_BULLETINS_FILE = 256 * 1024;
const MAX_MACHINES = 20;
const MAX_DISKS = 12;

export type BulletinMeasures = Omit<Bulletin, "version" | "health" | "backups">;

/**
 * The measures only (ADR-0040, R1): picked field by field, so that a field
 * added to Bulletin stays out until someone decides the page should show it.
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

export type MachineUnread = "injoignable" | "illisible" | "cle" | "autre-hote";
const UNREAD: readonly string[] = ["injoignable", "illisible", "cle", "autre-hote"];

/**
 * Every machine carries the sources parc.local.toml declares (S2b), read or
 * not: a machine that expects backups and could not be read says so. A read
 * one carries the ronde's judgment of each source; null for a bulletin that
 * recites none (versions 1 and 2).
 */
export type MachineRead =
  | {
      readonly name: string;
      readonly read: "ok";
      readonly bulletin: BulletinMeasures;
      readonly declared: readonly BackupSource[];
      readonly backups: readonly FileBackup[] | null;
    }
  | {
      readonly name: string;
      readonly read: MachineUnread;
      readonly declared: readonly BackupSource[];
    };

export interface RondeBulletins {
  /** When the pass ended, in ms. */
  readonly at: number;
  /** parc.local.toml: absent (no machine to read), unreadable, or read. */
  readonly config: "absent" | "illisible" | "ok";
  readonly machines: readonly MachineRead[];
}

export class RondeBulletinsError extends Error {
  constructor(message: string) {
    super(`unreadable ronde bulletins: ${message}`);
    this.name = "RondeBulletinsError";
  }
}

const fail = (what: string): never => {
  throw new RondeBulletinsError(what);
};
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
const keysAre = (o: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HOST = /^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$/;
const MOUNT = /^\/[A-Za-z0-9._/-]{0,100}$/;

function memoryOf(v: unknown): BulletinMeasures["memory"] {
  if (v === null) return null;
  if (!record(v) || !keysAre(v, ["total", "available"])) return fail("memory");
  const { total, available } = v;
  if (!count(total, 1e13) || !count(available, 1e13) || available > total) return fail("memory");
  return { total, available };
}

function disksOf(v: unknown): BulletinMeasures["disks"] {
  if (!Array.isArray(v) || v.length > MAX_DISKS) return fail("disks");
  return v.map((d) => {
    if (!record(d) || !keysAre(d, ["mount", "percent", "kilobytes"])) return fail("disk");
    const { mount, percent, kilobytes } = d;
    if (typeof mount !== "string" || !MOUNT.test(mount) || mount.split("/").includes("..")) {
      return fail("disk mount");
    }
    if (!count(percent, 100) || !count(kilobytes, 1e15)) return fail("disk");
    return { mount, percent, kilobytes };
  });
}

function measuresOf(v: unknown): BulletinMeasures {
  const keys = ["host", "at", "uptimeSeconds", "load", "cpus", "memory", "disks"];
  if (!record(v) || !keysAre(v, keys)) return fail("measures out of shape");
  const { host, at, uptimeSeconds, load, cpus } = v;
  if (typeof host !== "string" || !HOST.test(host)) return fail("host");
  if (!count(at, 1e14)) return fail("at");
  if (uptimeSeconds !== null && !count(uptimeSeconds, 10 * 365 * 86_400)) return fail("uptime");
  if (cpus !== null && !count(cpus, 4096)) return fail("cpus");
  let loads: BulletinMeasures["load"] = null;
  if (load !== null) {
    if (!Array.isArray(load) || load.length !== 3) return fail("load");
    const [l1, l5, l15] = load as unknown[];
    if (!count(l1, 100_000) || !count(l5, 100_000) || !count(l15, 100_000)) return fail("load");
    loads = [l1, l5, l15];
  }
  return {
    host,
    at,
    uptimeSeconds,
    load: loads,
    cpus,
    memory: memoryOf(v.memory),
    disks: disksOf(v.disks),
  };
}

/** The file the page reads, checked whole; throws RondeBulletinsError. */
export function parseRondeBulletins(raw: string): RondeBulletins {
  if (raw.length > MAX_BULLETINS_FILE) return fail("too large");
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return fail("not JSON");
  }
  if (!record(data) || !keysAre(data, ["at", "config", "machines"])) return fail("out of shape");
  const { at, config, machines } = data;
  if (!count(at, 1e14)) return fail("at");
  if (config !== "absent" && config !== "illisible" && config !== "ok") return fail("config");
  if (!Array.isArray(machines) || machines.length > MAX_MACHINES) return fail("machines");
  if (config !== "ok" && machines.length > 0) return fail("machines without a configuration");
  const names = new Set<string>();
  const out = machines.map((m): MachineRead => {
    if (!record(m) || typeof m.name !== "string" || !NAME.test(m.name)) return fail("name");
    if (names.has(m.name)) return fail("a machine twice");
    names.add(m.name);
    if (m.read === "ok") {
      if (!keysAre(m, ["name", "read", "bulletin", "declared", "backups"])) {
        return fail("machine out of shape");
      }
      const declared = declaredOf(m.declared, fail);
      return {
        name: m.name,
        read: "ok",
        bulletin: measuresOf(m.bulletin),
        declared,
        backups: backupsOf(m.backups, declared, fail),
      };
    }
    if (
      !keysAre(m, ["name", "read", "declared"]) ||
      typeof m.read !== "string" ||
      !UNREAD.includes(m.read)
    ) {
      return fail("read");
    }
    return { name: m.name, read: m.read as MachineUnread, declared: declaredOf(m.declared, fail) };
  });
  return { at, config, machines: out };
}
