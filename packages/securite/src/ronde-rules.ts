/**
 * The ronde's judgement (ADR-0040, R2), ported from Legion's regles.py: three
 * states, the worst wins, every motif kept, in Legion's order and in its exact
 * words — those words are a contract: the security agent (parse-legion.ts)
 * and the operator recognize them. Pure: a bulletin and what this machine is
 * expected to be, in; a state and its motifs, out.
 *
 * What is not Legion's, on purpose (ADR-0040): no fail2ban nor SSH journal
 * rule (the bulletin never recites them); the bulletin's own host name is
 * checked against the declared one; a failure is said in fixed words, never
 * with ssh's error output.
 */
import type { Bulletin } from "./bulletin.ts";
import type { BackupSource } from "./bulletin-backups.ts";
import { backupMotifs } from "./ronde-backups.ts";

export type RondeState = "SAIN" | "SOUFFRANT" | "MALADE";

export interface HostVerdict {
  readonly state: RondeState;
  readonly motifs: readonly string[];
}

/** What a machine is expected to be (parc.local.toml). */
export interface MachineExpectation {
  /** The host name its bulletin must recite; null when not declared. */
  readonly hostname: string | null;
  /** The ports expected to listen, Legion's three jokers allowed. */
  readonly ports: readonly string[];
  readonly diskWarn: number;
  readonly diskAlert: number;
  /** The backup sources it must recite (ADR-0043); none, none judged. */
  readonly backups: readonly BackupSource[];
}

/** Legion's three jokers, the only ones (its ADR-029). */
export const PORT_JOKERS: readonly string[] = ["tailnet/tcp/*", "tailnet/udp/*", "local/tcp/*"];
/** `local/tcp/*` covers the ephemeral range only. */
export const EPHEMERAL_MIN = 32_768;
export const DISK_WARN = 80;
export const DISK_ALERT = 90;
/** Older than this, or this far in the future, the bulletin is said so. */
export const BULLETIN_AGE_MAX_S = 900;
const MEMORY_ALERT = 5;
/**
 * Ports per motif: 12 of the longest (`tailnet/tcp/65535`) stay under the 300
 * characters the security agent reads — a longer list would make the whole
 * verdict unreadable, every machine with it. Legion writes one motif.
 */
export const PORTS_PER_MOTIF = 12;

const RANK: Readonly<Record<RondeState, number>> = { SAIN: 0, SOUFFRANT: 1, MALADE: 2 };

/** The worst of several states (SAIN for none). */
export function worstState(states: readonly RondeState[]): RondeState {
  return states.reduce<RondeState>((a, b) => (RANK[b] > RANK[a] ? b : a), "SAIN");
}

/** Why a machine could not be judged: MALADE, one motif, never SAIN. */
export type RondeFailure = "cle" | "delai" | "lancement" | "ssh" | "illisible";

export function failureVerdict(name: string, failure: RondeFailure, code = 0): HostVerdict {
  const motif =
    failure === "cle"
      ? `${name} : cle du bulletin mal protegee — non utilisee`
      : failure === "delai"
        ? `${name} : injoignable (delai depasse)`
        : failure === "lancement"
          ? `${name} : ssh n'a pas pu etre lance`
          : failure === "ssh"
            ? code === 255
              ? `${name} : injoignable (ssh a rendu 255)`
              : `${name} : ssh a rendu ${code}`
            : `${name} : bulletin illisible`;
  return { state: "MALADE", motifs: [motif] };
}

/** The ports a joker covers, as Legion's _couverts: plain ASCII digits after its prefix. */
function covered(open: ReadonlySet<string>, jokers: readonly string[]): Set<string> {
  const prefixes = jokers.map((j) => j.slice(0, -1));
  const out = new Set<string>();
  for (const port of open) {
    for (const prefix of prefixes) {
      const rest = port.slice(prefix.length);
      if (!port.startsWith(prefix) || !/^[0-9]+$/.test(rest)) continue;
      if (prefix === "local/tcp/" && Number(rest) < EPHEMERAL_MIN) continue;
      out.add(port);
    }
  }
  return out;
}

/** Legion's order: by code point, as Python's sorted(). */
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Recited ports against declared ones, as Legion's _juger_ports (exported for its tests). */
export function portMotifs(
  recited: readonly string[],
  expected: readonly string[],
): [RondeState, string][] {
  const open = new Set(recited);
  const declared = new Set(expected);
  const jokers = PORT_JOKERS.filter((j) => declared.has(j));
  const cover = covered(open, jokers);
  const unexpected = [...open].filter((p) => !declared.has(p) && !cover.has(p)).sort(byCodePoint);
  const missing = [...declared]
    .filter((p) => !jokers.includes(p) && !open.has(p))
    .sort(byCodePoint);
  const out: [RondeState, string][] = [];
  for (let i = 0; i < unexpected.length; i += PORTS_PER_MOTIF) {
    const some = unexpected.slice(i, i + PORTS_PER_MOTIF).join(", ");
    out.push(["MALADE", `port(s) inattendu(s) : ${some}`]);
  }
  for (let i = 0; i < missing.length; i += PORTS_PER_MOTIF) {
    const some = missing.slice(i, i + PORTS_PER_MOTIF).join(", ");
    out.push(["SOUFFRANT", `port(s) attendu(s) absent(s) : ${some}`]);
  }
  return out;
}

type RecitedPort = NonNullable<NonNullable<Bulletin["health"]>["ports"]>[number];

/** A recited port as Legion writes it: `local/`, `tailnet/` or nothing, then protocol/port. */
const portText = (p: RecitedPort) =>
  `${p.scope === "autre" ? "" : `${p.scope}/`}${p.protocol}/${p.port}`;

/** Judges one machine's bulletin, read at `nowMs`. */
export function judge(
  name: string,
  b: Bulletin,
  expected: MachineExpectation,
  nowMs: number,
): HostVerdict {
  // Another machine's bulletin: none of its facts is this machine's.
  if (expected.hostname !== null && b.host !== expected.hostname) {
    return { state: "MALADE", motifs: [`bulletin d'un autre hote (${b.host}) — non juge`] };
  }
  const found: [RondeState, string][] = [];
  if (expected.hostname === null) {
    found.push(["SOUFFRANT", "nom d'hote attendu non declare — le bulletin n'est pas verifie"]);
  }

  const gap = Math.floor(nowMs / 1000) - Math.floor(b.at / 1000);
  if (gap > BULLETIN_AGE_MAX_S) found.push(["SOUFFRANT", `bulletin vieux de ${gap} s`]);
  else if (gap < -BULLETIN_AGE_MAX_S) found.push(["SOUFFRANT", `horloge en avance de ${-gap} s`]);

  const h = b.health;
  if (h?.rebootRequired === true) {
    found.push(["SOUFFRANT", "redemarrage requis — un noyau corrige mais non charge"]);
  }

  if (b.disks.length === 0) {
    found.push(["SOUFFRANT", "aucun disque recite — on ne sait pas s'ils se remplissent"]);
  }
  for (const d of [...b.disks].sort((x, y) => byCodePoint(x.mount, y.mount))) {
    const motif = `disque ${d.mount} occupe a ${d.percent} %`;
    if (d.percent >= expected.diskAlert) found.push(["MALADE", motif]);
    else if (d.percent >= expected.diskWarn) found.push(["SOUFFRANT", motif]);
  }

  if (b.memory !== null) {
    // Legion refuses to judge a machine with no memory at all.
    if (b.memory.total === 0) {
      return { state: "MALADE", motifs: [`${name} : memoire totale nulle`] };
    }
    const part = Math.floor((b.memory.available * 100) / b.memory.total);
    if (part < MEMORY_ALERT) found.push(["SOUFFRANT", `memoire disponible a ${part} %`]);
  }

  // What could not be read is said, never taken for a zero (Legion's ADR-025).
  if (!h?.updates) found.push(["SOUFFRANT", "mises a jour non recitees"]);
  else if (h.updates.security > 0) {
    found.push(["SOUFFRANT", `${h.updates.security} mise(s) a jour de securite en attente`]);
  }

  const services = h?.servicesToRestart ?? null;
  if (services === null) found.push(["SOUFFRANT", "services a redemarrer non recites"]);
  else if (services > 0) {
    found.push(["SOUFFRANT", `${services} service(s) tournent sur une bibliotheque remplacee`]);
  }

  if (!h?.ports) found.push(["SOUFFRANT", "ports en ecoute non recites"]);
  else if (expected.ports.length === 0) {
    found.push(["SOUFFRANT", "aucun port attendu declare — rien n'est controle"]);
  } else found.push(...portMotifs(h.ports.map(portText), expected.ports));

  const cluster = h?.cluster;
  if (cluster?.quorum === "illisible") {
    found.push([
      "SOUFFRANT",
      "pvecm present mais quorum illisible — on ne sait pas si /etc/pve s'ecrit",
    ]);
  } else if (cluster?.quorum === "non") {
    const votes =
      cluster.votes !== null && cluster.expected !== null
        ? ` (${cluster.votes} vote(s) sur ${cluster.expected})`
        : "";
    found.push(["MALADE", `grappe sans quorum${votes} — /etc/pve en lecture seule`]);
  }

  // The backups last (ADR-0043): Legion's motifs keep their order.
  found.push(...backupMotifs(b, expected.backups));

  return { state: worstState(found.map(([s]) => s)), motifs: found.map(([, m]) => m) };
}
