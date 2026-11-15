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
  injoignable: "bulletin injoignable (machine éteinte, réseau, ou clé d'hôte refusée)",
  illisible: "bulletin illisible",
  cle: "clé du bulletin mal protégée : non utilisée",
  "autre-hote": "le bulletin vient d'une autre machine que celle déclarée",
};

/**
 * What the page says of the ronde's file (ADR-0040), when anything is off:
 * not written yet, unreadable, or too old — never fresh measures by default.
 */
export function rondeNote(machines: ParcView["machines"]): string | null {
  if (machines === null) return null;
  if (machines.ronde === "absente") {
    return "La ronde n'a pas encore tourné : aucune mesure des machines.";
  }
  if (machines.ronde === "illisible") {
    return "Le fichier de la ronde est illisible : aucune mesure des machines.";
  }
  if (machines.stale) {
    return "Les mesures datent d'une ronde trop ancienne (ou datée du futur) : la ronde ne passe plus ?";
  }
  return null;
}

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

const RANK: Readonly<Record<Tone, number>> = { bon: 0, inconnu: 1, attention: 2, mauvais: 3 };
const worst = (tones: readonly Tone[]): Tone =>
  tones.reduce<Tone>((a, b) => (RANK[b] > RANK[a] ? b : a), "bon");

/**
 * The card's frame: the worst of what is known — Legion's state, a gauge, a
 * disk in fault, something unread. Nothing known at all: unknown, never green.
 */
export function cardTone(m: MachineCard, legionTone: Tone | null): Tone {
  const tones: Tone[] = [];
  if (legionTone !== null) tones.push(legionTone);
  for (const p of [m.cpu, m.memory, ...m.disks.map((d) => d.percent)]) {
    if (p !== null) tones.push(gaugeTone(p));
  }
  if (m.node?.disks?.some((d) => d.healthy === false)) tones.push("mauvais");
  if (m.unread.length > 0) tones.push("attention");
  return tones.length === 0 ? "inconnu" : worst(tones);
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

/**
 * One machine, whatever case each source writes its name in: Legion and the
 * bulletin may say « node01 », Proxmox « Node01 » (seen 14/11) — one card, not two.
 * The name shown is the first source's: Legion, then the bulletin, then Proxmox.
 */
const keyOf = (name: string) => name.toLowerCase();

export function machinesOf(view: ParcView): MachineCard[] {
  const shown = new Map<string, string>();
  const see = (name: string) => {
    if (!shown.has(keyOf(name))) shown.set(keyOf(name), name);
  };
  const legion = view.servers.read === "ok" ? view.servers : null;
  for (const h of legion?.hosts ?? []) see(h.name);
  const bulletins = new Map((view.machines?.machines ?? []).map((m) => [keyOf(m.name), m]));
  for (const m of view.machines?.machines ?? []) see(m.name);
  const proxmoxNodes = view.proxmox?.read === "ok" ? view.proxmox.nodes : [];
  const nodes = new Map(proxmoxNodes.map((n) => [keyOf(n.name), n]));
  for (const n of proxmoxNodes) see(n.name);

  return [...shown.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([key, name]) => {
      const host = legion?.hosts.find((h) => keyOf(h.name) === key);
      const read = bulletins.get(key);
      const bulletin = read?.read === "ok" ? read.bulletin : null;
      const node = nodes.get(key) ?? null;
      const unread: string[] = [];
      if (read !== undefined && read.read !== "ok") {
        unread.push(BULLETIN_UNREAD[read.read] ?? "bulletin illisible");
      }
      if (node !== null && !node.online) unread.push("nœud hors ligne pour Proxmox");
      if (node?.online && node.disks === null) unread.push("disques du nœud non lus");
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
