/**
 * The machines' measures for the Parc tab (ADR-0039, ADR-0040 R2): read from
 * the file the ronde leaves on the Mac, never from the machines — the page's
 * server holds no key and launches no ssh. Measures only (the ronde writes
 * nothing else there). A file missing, out of shape or too old is said as
 * such, never shown as fresh.
 */
import {
  MAX_BULLETINS_FILE,
  type MachineRead,
  parseRondeBulletins,
  type RondeBulletins,
} from "@cenacle/securite";

export type { BulletinMeasures, MachineRead } from "@cenacle/securite";

/** Four passes missed (ADR-0040, point 5): the measures are old news. */
export const RONDE_STALE_MS = 20 * 60_000;
const FUTURE_TOLERANCE_MS = 5 * 60_000;

export interface MachinesView {
  /** The ronde's file: not written yet, unreadable, or read. */
  readonly ronde: "absente" | "illisible" | "ok";
  /** When the ronde last passed, in ms; null unless read. */
  readonly at: number | null;
  /** Four passes missed, or from the future: shown, marked. */
  readonly stale: boolean;
  /** The park's configuration, as the ronde found it. */
  readonly config: RondeBulletins["config"];
  readonly machines: readonly MachineRead[];
}

export interface MachinesDeps {
  /** The ronde's file, or null when it is absent; throws when it cannot be read. */
  readonly readFile: () => string | null;
  readonly now: () => number;
}

const unread = (ronde: "absente" | "illisible"): MachinesView => ({
  ronde,
  at: null,
  stale: false,
  config: "absent",
  machines: [],
});

/** What the page is told when reading the machines failed outright. */
export const MACHINES_UNREADABLE: MachinesView = unread("illisible");

export function createMachines(deps: MachinesDeps): () => Promise<MachinesView> {
  return async () => {
    let raw: string | null;
    try {
      raw = deps.readFile();
    } catch {
      return unread("illisible");
    }
    if (raw === null) return unread("absente");
    if (raw.length > MAX_BULLETINS_FILE) return unread("illisible");
    let file: RondeBulletins;
    try {
      file = parseRondeBulletins(raw);
    } catch {
      return unread("illisible");
    }
    const age = deps.now() - file.at;
    return {
      ronde: "ok",
      at: file.at,
      stale: age > RONDE_STALE_MS || age < -FUTURE_TOLERANCE_MS,
      config: file.config,
      machines: file.machines,
    };
  };
}
