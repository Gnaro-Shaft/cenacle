/**
 * The two rondes side by side (ADR-0040, R3): while both run, each difference
 * is a finding of its own, said once (in the morning report) and closed when
 * it goes. Compared, machine by machine: being named at all, the state, and
 * every typed finding (a port, a disk, updates, services, a reboot, the
 * quorum). The other motifs are not compared word for word — Legion quotes
 * ssh's errors and recites fail2ban, Cénacle does neither (ADR-0040) — their
 * weight shows in the state. Pure: two verdicts and the time, in; the
 * differences, out. A verdict missing, unreadable or too old for its own
 * source: thrown — the comparison could not run, it never says "no difference".
 */
import { legionView, parseLegionVerdict } from "./parse-legion.ts";
import { CENACLE_STALE_MS } from "./ronde-source.ts";
import type { Observation } from "./types.ts";

export const COMPARE_CHECK = "ronde_comparaison";
export const DIFFERENCE = "ronde_ecart";

type Side = "legion" | "cenacle";
const WORDS: Readonly<Record<Side, string>> = { legion: "Legion", cenacle: "Cénacle" };

const difference = (host: string, occurrence: string, title: string): Observation => ({
  type: DIFFERENCE,
  target: host,
  occurrence,
  severity: "info",
  title: `${host} : ${title}`,
  params: { host },
});

/** Each host's typed findings, keyed by kind and occurrence, with their words. */
function typed(observations: readonly Observation[]): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const o of observations) {
    if (o.type === "serveur_autre") continue;
    const host = out.get(o.target) ?? new Map<string, string>();
    host.set(`${o.type}:${o.occurrence}`, o.title.slice(o.target.length + 3));
    out.set(o.target, host);
  }
  return out;
}

export function compareVerdicts(legion: string, cenacle: string, nowMs: number): Observation[] {
  // Each read at its own source's limit: thrown when missing, unreadable or too old.
  const found = {
    legion: typed(parseLegionVerdict(legion, nowMs)),
    cenacle: typed(parseLegionVerdict(cenacle, nowMs, CENACLE_STALE_MS)),
  };
  const states = {
    legion: new Map(legionView(legion, nowMs).hosts.map((h) => [h.name, h.state])),
    cenacle: new Map(
      legionView(cenacle, nowMs, CENACLE_STALE_MS).hosts.map((h) => [h.name, h.state]),
    ),
  };
  const hosts = [...new Set([...states.legion.keys(), ...states.cenacle.keys()])].sort();
  const out: Observation[] = [];
  for (const host of hosts) {
    const l = states.legion.get(host);
    const c = states.cenacle.get(host);
    if (l === undefined || c === undefined) {
      const side: Side = l === undefined ? "cenacle" : "legion";
      out.push(
        difference(host, `machine:${side}`, `jugée seulement par la ronde de ${WORDS[side]}`),
      );
      continue;
    }
    if (l !== c) out.push(difference(host, "etat", `Legion la dit ${l}, Cénacle la dit ${c}`));
    for (const [side, other] of [
      ["legion", "cenacle"],
      ["cenacle", "legion"],
    ] as const) {
      const mine = found[side].get(host) ?? new Map<string, string>();
      const theirs = found[other].get(host) ?? new Map<string, string>();
      for (const [key, words] of mine) {
        if (theirs.has(key)) continue;
        out.push(difference(host, `${key}:${side}`, `${words} — vu seulement par ${WORDS[side]}`));
      }
    }
  }
  return out;
}
