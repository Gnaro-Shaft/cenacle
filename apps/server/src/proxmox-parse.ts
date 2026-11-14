/**
 * Reading the Proxmox API's answers (ADR-0039), pure: the cluster's
 * resources (nodes, virtual machines, containers) and a node's disks. Only
 * the fields the page shows come out, checked one by one; anything else in
 * the answer is ignored, never passed on. An answer out of shape is refused
 * whole (ProxmoxShapeError), never half shown.
 */

export class ProxmoxShapeError extends Error {
  constructor(message: string) {
    super(`unreadable Proxmox answer: ${message}`);
    this.name = "ProxmoxShapeError";
  }
}

export interface ProxmoxGuest {
  readonly id: number;
  readonly name: string;
  readonly kind: "vm" | "ct";
  readonly running: boolean;
  /** 0 to 100, of its own processors. */
  readonly cpuPercent: number;
  readonly memoryPercent: number | null;
}

export interface ProxmoxNode {
  readonly name: string;
  readonly online: boolean;
  readonly cpuPercent: number | null;
  readonly memory: { readonly used: number; readonly total: number } | null;
  readonly uptimeSeconds: number | null;
  readonly guests: readonly ProxmoxGuest[];
}

export interface ProxmoxDisk {
  readonly device: string;
  readonly model: string;
  readonly kind: string;
  /** Percent of life left, as Proxmox says it; null when it does not know. */
  readonly wearLeft: number | null;
  readonly healthy: boolean | null;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const DEVICE = /^\/dev\/[A-Za-z0-9_-]{1,40}$/;
const MAX_ITEMS = 500;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : null;
const ratio = (v: unknown): number | null => {
  const r = num(v, 1);
  return r === null ? null : Math.round(r * 100);
};
const percent = (part: number | null, whole: number | null): number | null =>
  part === null || whole === null || whole === 0
    ? null
    : Math.min(100, Math.round((part / whole) * 100));

function dataList(body: unknown): unknown[] {
  if (!isObject(body) || !Array.isArray(body.data)) throw new ProxmoxShapeError("no data list");
  if (body.data.length > MAX_ITEMS) throw new ProxmoxShapeError("too many items");
  return body.data;
}

type GuestOf = ProxmoxGuest & { readonly node: string };

function guestOf(item: Record<string, unknown>, node: string | null): GuestOf {
  const id = num(item.vmid, 999_999_999);
  if (node === null || id === null || !Number.isInteger(id)) {
    throw new ProxmoxShapeError("a guest without node or id");
  }
  return {
    node,
    id,
    name: typeof item.name === "string" && NAME.test(item.name) ? item.name : `${id}`,
    kind: item.type === "qemu" ? "vm" : "ct",
    running: item.status === "running",
    cpuPercent: ratio(item.cpu) ?? 0,
    memoryPercent: percent(num(item.mem, 1e15), num(item.maxmem, 1e15)),
  };
}

/** GET /cluster/resources: each node with its guests, by name. */
export function parseResources(body: unknown): ProxmoxNode[] {
  const nodes = new Map<string, Omit<ProxmoxNode, "guests">>();
  const guests: GuestOf[] = [];
  for (const item of dataList(body)) {
    if (!isObject(item)) throw new ProxmoxShapeError("an item that is not an object");
    const node = typeof item.node === "string" && NAME.test(item.node) ? item.node : null;
    if (item.type === "node") {
      if (node === null) throw new ProxmoxShapeError("a node without a name");
      const total = num(item.maxmem, 1e15);
      const used = num(item.mem, 1e15);
      nodes.set(node, {
        name: node,
        online: item.status === "online",
        cpuPercent: ratio(item.cpu),
        memory: total !== null && used !== null && used <= total ? { used, total } : null,
        uptimeSeconds: num(item.uptime, 1e10),
      });
    } else if (item.type === "qemu" || item.type === "lxc") {
      guests.push(guestOf(item, node));
    }
    // Storages, pools, SDN: not shown, not passed on.
  }
  return [...nodes.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((n) => ({
      ...n,
      guests: guests
        .filter((g) => g.node === n.name)
        .sort((a, b) => a.id - b.id)
        .map(({ node: _node, ...g }) => g),
    }));
}

function healthOf(v: unknown): boolean | null {
  if (typeof v !== "string") return null;
  const h = v.toUpperCase();
  if (h === "PASSED" || h === "OK") return true;
  return h === "UNKNOWN" ? null : false;
}

/** GET /nodes/{node}/disks/list: each disk, its model, its wear, its health. */
export function parseDisks(body: unknown): ProxmoxDisk[] {
  return dataList(body).map((item) => {
    if (!isObject(item)) throw new ProxmoxShapeError("a disk that is not an object");
    if (typeof item.devpath !== "string" || !DEVICE.test(item.devpath)) {
      throw new ProxmoxShapeError("a disk without a device");
    }
    return {
      device: item.devpath,
      model:
        typeof item.model === "string"
          ? item.model.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 60)
          : "",
      kind: typeof item.type === "string" && /^[a-z]{1,10}$/.test(item.type) ? item.type : "disque",
      wearLeft: num(item.wearout, 100),
      healthy: healthOf(item.health),
    };
  });
}
