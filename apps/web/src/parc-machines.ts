/**
 * One card per machine (ADR-0039), pure: what each source knows of a machine
 * under one name — Legion's state and motifs, the machine's own bulletin
 * (load, memory, disks), Proxmox for a node (processor, memory, guests,
 * disks' wear). A source that could not be read is said on the card, never
 * filled with a guess; a gauge with no measure is no gauge.
 */
import type { BulletinView, ParcView, ProxmoxNodeView } from "./api.ts";
import type { LegionState, Tone } from "./parc-rules.ts";

export interface MachineCard {
  readonly name: string;
  /** Legion's word, while Legion runs; null when it does not name this machine. */
  readonly legion: {
    readonly state: LegionState;
    readonly stale: boolean;
    readonly motifs: readonly string[];
  } | null;
  /** 0–100, or null when no source measures it. */
  readonly cpu: number | null;
  readonly memory: number | null;
  readonly disks: readonly { readonly label: string; readonly percent: number }[];
  readonly node: ProxmoxNodeView | null;
  /** What could not be read for this machine, in words. */
  readonly unread: readonly string[];
}

const BULLETIN_UNREAD: Readonly<Record<string, string>> = {
  injoignable: "bulletin injoignable",
  illisible: "bulletin illisible",
  cle: "clé du bulletin mal protégée : non utilisée",
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Load over processors, as a share: a load of 4 on 4 processors is 100 %. */
function loadPercent(b: BulletinView): number | null {
  if (b.load === null || b.cpus === null || b.cpus === 0) return null;
  return clamp(b.load[0] / b.cpus);
}

function memoryPercent(b: BulletinView): number | null {
  if (b.memory === null || b.memory.total === 0) return null;
  return clamp(((b.memory.total - b.memory.available) / b.memory.total) * 100);
}

/** Green under 70 %, amber under 90 %, red beyond. */
export const gaugeTone = (percent: number): Tone =>
  percent >= 90 ? "mauvais" : percent >= 70 ? "attention" : "bon";

function nodeCpu(node: ProxmoxNodeView | null): number | null {
  return node?.online && node.cpuPercent !== null ? clamp(node.cpuPercent) : null;
}

function nodeMemory(node: ProxmoxNodeView | null): number | null {
  if (!node?.online || node.memory === null || node.memory.total <= 0) return null;
  return clamp((node.memory.used / node.memory.total) * 100);
}

export function machinesOf(view: ParcView): MachineCard[] {
  const names = new Set<string>();
  const legion = view.servers.read === "ok" ? view.servers : null;
  for (const h of legion?.hosts ?? []) names.add(h.name);
  const bulletins = new Map((view.machines?.machines ?? []).map((m) => [m.name, m]));
  for (const name of bulletins.keys()) names.add(name);
  const nodes = new Map(
    (view.proxmox?.read === "ok" ? view.proxmox.nodes : []).map((n) => [n.name, n]),
  );
  for (const name of nodes.keys()) names.add(name);

  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const host = legion?.hosts.find((h) => h.name === name);
      const read = bulletins.get(name);
      const bulletin = read?.read === "ok" ? read.bulletin : null;
      const node = nodes.get(name) ?? null;
      const unread: string[] = [];
      if (read !== undefined && read.read !== "ok") {
        unread.push(BULLETIN_UNREAD[read.read] ?? "bulletin illisible");
      }
      if (node !== null && !node.online) unread.push("nœud hors ligne pour Proxmox");
      // Proxmox measures the processor itself; the bulletin, the load: Proxmox first.
      return {
        name,
        legion:
          host === undefined || legion === null
            ? null
            : { state: host.state, stale: legion.stale, motifs: host.motifs },
        cpu: nodeCpu(node) ?? (bulletin ? loadPercent(bulletin) : null),
        memory: nodeMemory(node) ?? (bulletin ? memoryPercent(bulletin) : null),
        disks: (bulletin?.disks ?? []).map((d) => ({ label: d.mount, percent: clamp(d.percent) })),
        node,
        unread,
      };
    });
}
