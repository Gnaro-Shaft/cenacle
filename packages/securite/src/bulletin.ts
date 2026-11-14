/**
 * Reading a server's bulletin (ADR-0039): what deploy/serveurs/cenacle-bulletin
 * recites, key=value lines between bulletin=1 and fin=1. Strict, as Legion's
 * reader is (its ADR-029): cut short, a key twice, a key it does not know, a
 * value out of shape — the whole bulletin is unreadable, never half shown.
 * The machine's identity is proved by its pinned host key (StrictHostKeyChecking),
 * not by what it says its name is. Pure: text in, measures out.
 */
import { plainOutput } from "./parse-mac.ts";

/** A bulletin is a few hundred bytes; anything larger is not one. */
export const MAX_BULLETIN = 16 * 1024;
const MAX_DISKS = 12;

export interface Bulletin {
  readonly host: string;
  /** When the server recited it, in ms. */
  readonly at: number;
  readonly uptimeSeconds: number | null;
  /** Load averages, in hundredths (1 min, 5 min, 15 min). */
  readonly load: readonly [number, number, number] | null;
  readonly cpus: number | null;
  /** Kilobytes. */
  readonly memory: { readonly total: number; readonly available: number } | null;
  readonly disks: readonly {
    readonly mount: string;
    readonly percent: number;
    readonly kilobytes: number;
  }[];
}

export class BulletinError extends Error {
  constructor(message: string) {
    super(`unreadable bulletin: ${message}`);
    this.name = "BulletinError";
  }
}

const KNOWN =
  /^(?:bulletin|version|hote|instant|uptime|charge1|charge5|charge15|processeurs|memoire\.totale|memoire\.disponible|disque\.\d{1,2}\.(?:montage|pourcent|kilooctets)|fin)$/;
const HOST = /^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$/;
const MOUNT = /^\/[A-Za-z0-9._/-]{0,100}$/;
const WHOLE = /^\d{1,15}$/;

function whole(fields: ReadonlyMap<string, string>, key: string, max: number): number | null {
  const value = fields.get(key);
  if (value === undefined) return null;
  if (!WHOLE.test(value) || Number(value) > max) throw new BulletinError(`${key} out of shape`);
  return Number(value);
}

export function parseBulletin(raw: string): Bulletin {
  if (raw.length > MAX_BULLETIN) throw new BulletinError("too large");
  const lines = plainOutput(raw)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lines[0] !== "bulletin=1" || lines.at(-1) !== "fin=1") throw new BulletinError("cut short");
  const fields = new Map<string, string>();
  for (const line of lines) {
    const at = line.indexOf("=");
    if (at <= 0) throw new BulletinError("a line without key");
    const key = line.slice(0, at);
    if (!KNOWN.test(key)) throw new BulletinError(`unknown key ${key.slice(0, 40)}`);
    if (fields.has(key)) throw new BulletinError(`${key} twice`);
    fields.set(key, line.slice(at + 1));
  }
  if (fields.get("version") !== "1") throw new BulletinError("unknown version");
  const host = fields.get("hote") ?? "";
  if (!HOST.test(host)) throw new BulletinError("hote out of shape");
  const instant = whole(fields, "instant", 99_999_999_999);
  if (instant === null) throw new BulletinError("undated");

  const l1 = whole(fields, "charge1", 100_000);
  const l5 = whole(fields, "charge5", 100_000);
  const l15 = whole(fields, "charge15", 100_000);
  const total = whole(fields, "memoire.totale", 1e13);
  const available = whole(fields, "memoire.disponible", 1e13);
  if (total !== null && available !== null && available > total) {
    throw new BulletinError("more memory available than there is");
  }

  const disks: { mount: string; percent: number; kilobytes: number }[] = [];
  for (let n = 1; fields.has(`disque.${n}.montage`); n++) {
    if (n > MAX_DISKS) throw new BulletinError("too many disks");
    const mount = fields.get(`disque.${n}.montage`) ?? "";
    if (!MOUNT.test(mount) || mount.split("/").includes("..")) {
      throw new BulletinError("disk mount out of shape");
    }
    const percent = whole(fields, `disque.${n}.pourcent`, 100);
    const kilobytes = whole(fields, `disque.${n}.kilooctets`, 1e15);
    if (percent === null || kilobytes === null) throw new BulletinError("a disk half said");
    disks.push({ mount, percent, kilobytes });
  }
  // Every disk key belongs to a disk read above: none skipped, none stray.
  const diskKeys = [...fields.keys()].filter((k) => k.startsWith("disque.")).length;
  if (diskKeys !== disks.length * 3) throw new BulletinError("disks out of order");

  return {
    host,
    at: instant * 1000,
    uptimeSeconds: whole(fields, "uptime", 10 * 365 * 86_400),
    load: l1 !== null && l5 !== null && l15 !== null ? [l1, l5, l15] : null,
    cpus: whole(fields, "processeurs", 4096),
    memory: total !== null && available !== null ? { total, available } : null,
    disks,
  };
}
