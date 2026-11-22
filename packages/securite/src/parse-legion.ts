/**
 * Reading a ronde verdict in Legion's format (ADR-0025, then ADR-0040): the
 * format Legion's ronde wrote, kept by Cénacle's own ronde, so that the agent,
 * the operator and the page read it unchanged. Since R4 (22/11/2026) only
 * Cénacle's ronde writes one. Each motif becomes a finding, followed like any
 * other. Strict: a verdict cut short, undated, from the future, older than its
 * source's limit or whose host count does not add up "could not run" — it
 * proves nothing and closes no server finding. Names, mounts and
 * ports are checked before any use; a number that changes (10 then 12
 * updates) keeps the same finding, a new port opens a new one.
 */
import { plainOutput } from "./parse-mac.ts";
import { CheckOutputError, type Observation, type Severity } from "./types.ts";

const FUTURE_TOLERANCE_MS = 5 * 60_000;
const HOST = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MOUNT = /^\/[A-Za-z0-9._/-]{0,100}$/;
const PORT = /^(?:[a-z]{2,10}\/)?(?:tcp|udp)\/(?:\d{1,5}|\*)$/;
/** What a motif may hold: Legion writes plain French, ports and paths. The ronde writes nothing else. */
export const VERDICT_MOTIF = /^[\p{L}\p{N} .,:;'’()%/_+*<>=—-]{1,300}$/u;

const fail = () => new CheckOutputError("legion_ronde");

function ports(list: string): string[] {
  const out = list.split(",").map((p) => p.trim());
  if (out.length === 0 || out.length > 50 || !out.every((p) => PORT.test(p))) throw fail();
  return out;
}

const finding = (
  host: string,
  type: string,
  occurrence: string,
  severity: Severity,
  title: string,
  params: Record<string, string> = {},
): Observation => ({
  type,
  target: host,
  occurrence,
  severity,
  title,
  params: { host, ...params },
});

/** One of Legion's motifs, as findings (several for a list of ports). */
export function classifyMotif(host: string, motif: string): Observation[] {
  if (/^grappe sans quorum/.test(motif)) {
    return [
      finding(
        host,
        "serveur_quorum",
        "-",
        "critique",
        `${host} : grappe sans quorum, /etc/pve en lecture seule`,
      ),
    ];
  }
  let m = /^disque (\S+) occupe a (\d{1,3}) %$/.exec(motif);
  if (m !== null) {
    const [mount = "", used = "0"] = [m[1], m[2]];
    if (!MOUNT.test(mount)) throw fail();
    return [
      finding(
        host,
        "serveur_disque",
        mount,
        Number(used) >= 90 ? "eleve" : "moyen",
        `${host} : disque ${mount} occupé à ${used} %`,
        { mount },
      ),
    ];
  }
  m = /^(\d{1,5}) mise\(s\) a jour de securite en attente$/.exec(motif);
  if (m !== null) {
    return [
      finding(
        host,
        "serveur_maj_securite",
        "-",
        "eleve",
        `${host} : ${m[1]} mise(s) à jour de sécurité en attente`,
        { count: String(Number(m[1])) },
      ),
    ];
  }
  m = /^port\(s\) inattendu\(s\) : (.+)$/.exec(motif);
  if (m !== null) {
    return ports(m[1] ?? "").map((port) =>
      finding(host, "serveur_port", port, "eleve", `${host} : port inattendu ${port}`, { port }),
    );
  }
  m = /^port\(s\) attendu\(s\) absent\(s\) : (.+)$/.exec(motif);
  if (m !== null) {
    return ports(m[1] ?? "").map((port) =>
      finding(host, "serveur_port_absent", port, "moyen", `${host} : port attendu absent ${port}`, {
        port,
      }),
    );
  }
  if (/^redemarrage requis/.test(motif)) {
    return [
      finding(
        host,
        "serveur_redemarrage",
        "-",
        "moyen",
        `${host} : redémarrage requis (noyau corrigé non chargé)`,
      ),
    ];
  }
  m = /^(\d{1,5}) service\(s\) tournent sur une bibliotheque remplacee$/.exec(motif);
  if (m !== null) {
    return [
      finding(
        host,
        "serveur_services",
        "-",
        "moyen",
        `${host} : ${m[1]} service(s) sur une bibliothèque remplacée`,
        // The count, for the operator's proof: 26 → 8 is not "still there" (J6f).
        { count: String(Number(m[1])) },
      ),
    ];
  }
  // Any other motif: kept, under its words without their numbers.
  const occurrence = motif.toLowerCase().replace(/\d+/g, "#").slice(0, 60);
  return [finding(host, "serveur_autre", occurrence, "moyen", `${host} : ${motif.slice(0, 200)}`)];
}

export type LegionState = "SAIN" | "SOUFFRANT" | "MALADE";
const STATES: readonly string[] = ["SAIN", "SOUFFRANT", "MALADE"];

/** The verdict as the page shows it (the Parc tab): stale is said, not refused. */
export interface LegionView {
  readonly state: LegionState;
  /** When Legion gave it, in ms. */
  readonly at: number;
  /** Three relays missed, or from the future: shown, marked. */
  readonly stale: boolean;
  readonly hosts: readonly {
    readonly name: string;
    readonly state: LegionState;
    /** Each motif in words (the findings' titles, without the host). */
    readonly motifs: readonly string[];
  }[];
}

/** The verdict for the page: as strict as the check, except on its age (its source's limit). */
export function legionView(raw: string, nowMs: number, staleMs: number): LegionView {
  const fields = verdictFields(raw);
  const at = Number(fields.get("instant")) * 1000;
  const age = nowMs - at;
  const hosts = hostsOf(fields).map((name) => {
    const state = fields.get(`${name}.etat`) ?? "";
    if (!STATES.includes(state)) throw fail();
    const motifs = [...fields]
      .filter(([key]) => /^(.+)\.motif\d{1,2}$/.exec(key)?.[1] === name)
      .flatMap(([, value]) => classifyMotif(name, value))
      .map((o) => o.title.slice(name.length + 3));
    return { name, state: state as LegionState, motifs };
  });
  return {
    state: fields.get("etat") as LegionState,
    at,
    stale: age > staleMs || age < -FUTURE_TOLERANCE_MS,
    hosts,
  };
}

/** The verdict's fields, checked whole: cut short, undated or out of shape "could not run". */
function verdictFields(raw: string): Map<string, string> {
  const lines = plainOutput(raw)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lines.length > 2000 || lines.at(-1) !== "fin=1") throw fail();
  const fields = new Map<string, string>();
  for (const line of lines) {
    const at = line.indexOf("=");
    if (at <= 0) throw fail();
    const key = line.slice(0, at);
    if (fields.has(key)) throw fail();
    fields.set(key, line.slice(at + 1));
  }
  if (!/^\d{9,11}$/.test(fields.get("instant") ?? "")) throw fail();
  if (!STATES.includes(fields.get("etat") ?? "")) throw fail();
  const hosts = hostsOf(fields);
  // Every motif belongs to a host the verdict counts, in Legion's words.
  for (const [key, value] of fields) {
    const m = /^([^.]+)\.motif(\d{1,2})$/.exec(key);
    if (m === null) continue;
    if (!hosts.includes(m[1] ?? "") || !VERDICT_MOTIF.test(value)) throw fail();
  }
  return fields;
}

/** The hosts the verdict names, as many as it says, each a plain name. */
function hostsOf(fields: ReadonlyMap<string, string>): string[] {
  const hosts = [...fields.keys()].flatMap((k) => {
    const h = /^([^.]+)\.etat$/.exec(k)?.[1];
    return h === undefined ? [] : [h];
  });
  if (hosts.length !== Number(fields.get("hotes")) || hosts.length > 50) throw fail();
  if (!hosts.every((h) => HOST.test(h))) throw fail();
  return hosts;
}

/** The verdict's findings; too old for its source (`staleMs`) or from the future, "could not run". */
export function parseLegionVerdict(raw: string, nowMs: number, staleMs: number): Observation[] {
  const fields = verdictFields(raw);
  const age = nowMs - Number(fields.get("instant")) * 1000;
  // Too old (Cénacle: four passes missed) or from the future: no watch is seen.
  if (age > staleMs || age < -FUTURE_TOLERANCE_MS) throw fail();
  const out: Observation[] = [];
  for (const [key, value] of fields) {
    const m = /^([^.]+)\.motif(\d{1,2})$/.exec(key);
    if (m !== null) out.push(...classifyMotif(m[1] ?? "", value));
  }
  return out;
}
