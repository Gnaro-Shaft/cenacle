/**
 * What a version 2 bulletin adds (ADR-0040): the facts the ronde judges —
 * a reboot required, updates waiting, services on a replaced library, the
 * cluster's quorum, the ports listening (their scope, never their address).
 *
 * As strict as the rest of the reader: a fact half said, or out of shape,
 * makes the whole bulletin unreadable. A fact the server could not read is
 * absent from the bulletin and null here: unknown, never zero (Legion's
 * ADR-025: what cannot be judged is an alert, not a clean bill).
 */
import { BulletinError, whole } from "./bulletin-fields.ts";

/** The keys only a version 2 bulletin may carry. */
export const HEALTH_KEYS: readonly string[] = [
  "redemarrage",
  "maj.total",
  "maj.securite",
  "services.a_relancer",
  "grappe.quorum",
  "grappe.votes",
  "grappe.attendus",
  "ports",
];

/** More listening sockets than this is not a server of ours: unreadable. */
export const MAX_PORTS = 256;
const MAX_COUNT = 100_000;
const MAX_VOTES = 1_000;

export type PortScope = "local" | "tailnet" | "autre";

export interface ListeningPort {
  /** Where it listens: the loopback, the tailnet, or anywhere else. */
  readonly scope: PortScope;
  readonly protocol: "tcp" | "udp";
  readonly port: number;
}

export interface BulletinHealth {
  readonly rebootRequired: boolean;
  readonly updates: { readonly total: number; readonly security: number } | null;
  readonly servicesToRestart: number | null;
  /** Null off a Proxmox cluster (no pvecm). */
  readonly cluster: {
    readonly quorum: "oui" | "non" | "illisible";
    readonly votes: number | null;
    readonly expected: number | null;
  } | null;
  /** Null when the server could not read them: never an empty list for "unknown". */
  readonly ports: readonly ListeningPort[] | null;
}

const PORT = /^(?:(local|tailnet)\/)?(tcp|udp)\/([1-9]\d{0,4})$/;
const QUORUM = new Set(["oui", "non", "illisible"]);

function parsePorts(value: string): ListeningPort[] {
  const items = value.split(",");
  if (items.length > MAX_PORTS) throw new BulletinError("too many ports");
  const seen = new Set<string>();
  return items.map((item) => {
    const m = PORT.exec(item);
    if (m === null) throw new BulletinError("a port out of shape");
    const port = Number(m[3]);
    if (port < 1 || port > 65_535) throw new BulletinError("a port out of range");
    if (seen.has(item)) throw new BulletinError("a port twice");
    seen.add(item);
    return {
      scope: (m[1] ?? "autre") as PortScope,
      protocol: m[2] as "tcp" | "udp",
      port,
    };
  });
}

/** Reads the version 2 facts from a bulletin's fields; throws BulletinError. */
export function parseHealth(fields: ReadonlyMap<string, string>): BulletinHealth {
  // The reboot is always said: a file present or not cannot fail to be read.
  const reboot = fields.get("redemarrage");
  if (reboot !== "requis" && reboot !== "non") throw new BulletinError("redemarrage out of shape");

  const total = whole(fields, "maj.total", MAX_COUNT);
  const security = whole(fields, "maj.securite", MAX_COUNT);
  if ((total === null) !== (security === null)) throw new BulletinError("updates half said");
  if (total !== null && security !== null && security > total) {
    throw new BulletinError("more security updates than updates");
  }

  const quorum = fields.get("grappe.quorum");
  const votes = whole(fields, "grappe.votes", MAX_VOTES);
  const expected = whole(fields, "grappe.attendus", MAX_VOTES);
  if (quorum === undefined && (votes !== null || expected !== null)) {
    throw new BulletinError("votes without a quorum");
  }
  if (quorum !== undefined && !QUORUM.has(quorum))
    throw new BulletinError("grappe.quorum out of shape");

  const ports = fields.get("ports");
  return {
    rebootRequired: reboot === "requis",
    updates: total !== null && security !== null ? { total, security } : null,
    servicesToRestart: whole(fields, "services.a_relancer", MAX_COUNT),
    cluster:
      quorum === undefined
        ? null
        : { quorum: quorum as "oui" | "non" | "illisible", votes, expected },
    ports: ports === undefined ? null : parsePorts(ports),
  };
}
