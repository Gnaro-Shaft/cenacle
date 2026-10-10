/**
 * Reading Legion's ronde verdict (the bridge, ADR-0025): Legion watches the
 * servers around the clock from a machine always on, and leaves a raw copy of
 * its verdict on the Mac; each of its motifs becomes a finding here, followed
 * like any other. Strict: a verdict cut short, undated, from the future, too
 * old (three missed relays) or whose host count does not add up "could not
 * run" — it proves nothing and closes no server finding. Names, mounts and
 * ports are checked before any use; a number that changes (10 then 12
 * updates) keeps the same finding, a new port opens a new one.
 */
import { plainOutput } from "./parse-mac.ts";
import { CheckOutputError, type Observation, type Severity } from "./types.ts";

export const LEGION_STALE_MS = 45 * 60_000;
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const HOST = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MOUNT = /^\/[A-Za-z0-9._/-]{0,100}$/;
const PORT = /^(?:[a-z]{2,10}\/)?(?:tcp|udp)\/(?:\d{1,5}|\*)$/;
/** What a motif may hold: Legion writes plain French, ports and paths. */
const MOTIF = /^[\p{L}\p{N} .,:;'’()%/_+*<>=—-]{1,300}$/u;

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
      ),
    ];
  }
  // Any other motif: kept, under its words without their numbers.
  const occurrence = motif.toLowerCase().replace(/\d+/g, "#").slice(0, 60);
  return [finding(host, "serveur_autre", occurrence, "moyen", `${host} : ${motif.slice(0, 200)}`)];
}

export function parseLegionVerdict(raw: string, nowMs: number): Observation[] {
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
  const instant = fields.get("instant") ?? "";
  if (!/^\d{9,11}$/.test(instant)) throw fail();
  const age = nowMs - Number(instant) * 1000;
  // Too old (three relays missed) or from the future: Legion's watch is not seen.
  if (age > LEGION_STALE_MS || age < -FUTURE_TOLERANCE_MS) throw fail();
  if (!["SAIN", "SOUFFRANT", "MALADE"].includes(fields.get("etat") ?? "")) throw fail();
  const hosts = [...fields.keys()].flatMap((k) => {
    const h = /^([^.]+)\.etat$/.exec(k)?.[1];
    return h === undefined ? [] : [h];
  });
  if (hosts.length !== Number(fields.get("hotes")) || hosts.length > 50) throw fail();
  if (!hosts.every((h) => HOST.test(h))) throw fail();
  const out: Observation[] = [];
  for (const [key, value] of fields) {
    const m = /^([^.]+)\.motif(\d{1,2})$/.exec(key);
    if (m === null) continue;
    const host = m[1] ?? "";
    if (!hosts.includes(host) || !MOTIF.test(value)) throw fail();
    out.push(...classifyMotif(host, value));
  }
  return out;
}
