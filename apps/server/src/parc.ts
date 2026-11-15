/**
 * The Parc tab (14/11): what Cénacle already knows of the machines, in one
 * answer — Legion's verdict on the servers (the bridge, ADR-0025), the
 * security findings still open, the security agent's last round, the
 * sentinel's last word; the machines' measures, from the file the ronde
 * leaves (ADR-0040), and Proxmox's view of its nodes (ADR-0039).
 *
 * Read-only, behind the page's token. A verdict missing, cut short or too
 * old is said as such — never shown as healthy.
 */
import { readFileSync } from "node:fs";
import type { FindingSeverity, ParcStore } from "@cenacle/journal";
import { type LegionState, legionView } from "@cenacle/securite";
import { MACHINES_UNREADABLE, type MachinesView } from "./machines.ts";
import type { ProxmoxView } from "./proxmox.ts";

/** A verdict is a few lines: anything larger is not one. */
const MAX_VERDICT = 64 * 1024;

export interface ParcView {
  readonly at: string;
  readonly servers:
    | { readonly read: "missing" | "unreadable" }
    | {
        readonly read: "ok";
        readonly state: LegionState;
        readonly at: string;
        readonly stale: boolean;
        readonly hosts: readonly {
          readonly name: string;
          readonly state: LegionState;
          readonly motifs: readonly string[];
        }[];
      };
  readonly findings: {
    readonly counts: Readonly<Record<FindingSeverity, number>>;
    readonly setAside: number;
    readonly open: readonly {
      readonly severity: FindingSeverity;
      readonly inCharge: boolean;
      readonly title: string;
      readonly since: string;
    }[];
  };
  readonly lastRound: {
    readonly at: string;
    readonly checks: number;
    readonly impossible: number;
    readonly network: boolean;
  } | null;
  readonly sentinel: { readonly up: boolean; readonly since: string } | null;
  /** Each machine's measures, as the ronde last read them (ADR-0040); null when not wired. */
  readonly machines: MachinesView | null;
  /** The Proxmox cluster (ADR-0039); null when not wired. */
  readonly proxmox: ProxmoxView | null;
}

export interface ParcDeps {
  readonly store: ParcStore;
  /** The raw verdict, or null when there is none. */
  readonly readVerdict: () => string | null;
  readonly now: () => Date;
  /** The machines' bulletins (machines.ts); absent, none are read. */
  readonly machines?: () => Promise<MachinesView>;
  /** The Proxmox cluster (proxmox.ts); absent, it is not read. */
  readonly proxmox?: () => Promise<ProxmoxView>;
}

/** The verdict file at `path`: null when absent; any other failure is thrown. */
export function verdictFile(path: string): () => string | null {
  return () => {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return null;
      throw error;
    }
  };
}

function servers(read: () => string | null, now: Date): ParcView["servers"] {
  let raw: string | null;
  try {
    raw = read();
  } catch {
    return { read: "unreadable" };
  }
  if (raw === null) return { read: "missing" };
  if (raw.length > MAX_VERDICT) return { read: "unreadable" };
  try {
    const view = legionView(raw, now.getTime());
    return {
      read: "ok",
      state: view.state,
      at: new Date(view.at).toISOString(),
      stale: view.stale,
      hosts: view.hosts,
    };
  } catch {
    return { read: "unreadable" };
  }
}

export function createParc(deps: ParcDeps): () => Promise<ParcView> {
  return async () => {
    const now = deps.now();
    const [findings, lastRound, sentinel, machines, proxmox] = await Promise.all([
      deps.store.findings(),
      deps.store.lastRound(),
      deps.store.sentinel(),
      // A source that fails says so on its own cards; it never takes the others down.
      deps.machines?.().catch(() => MACHINES_UNREADABLE) ?? Promise.resolve(null),
      deps.proxmox?.().catch(() => ({ read: "illisible" as const })) ?? Promise.resolve(null),
    ]);
    return {
      at: now.toISOString(),
      servers: servers(deps.readVerdict, now),
      findings: {
        counts: findings.counts,
        setAside: findings.setAside,
        open: findings.open.map((f) => ({
          severity: f.severity,
          inCharge: f.inCharge,
          title: f.title,
          since: f.since.toISOString(),
        })),
      },
      lastRound:
        lastRound === null
          ? null
          : {
              at: lastRound.at.toISOString(),
              checks: lastRound.checks,
              impossible: lastRound.impossible,
              network: lastRound.network,
            },
      sentinel: sentinel === null ? null : { up: sentinel.up, since: sentinel.since.toISOString() },
      machines,
      proxmox,
    };
  };
}
