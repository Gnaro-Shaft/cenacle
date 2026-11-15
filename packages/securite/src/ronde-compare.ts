/**
 * The two rondes side by side (ADR-0040, R3): while both run, each difference
 * is a finding of its own, said once (in the morning report) and closed when
 * it goes. Compared, machine by machine: being named at all, the state, and
 * every typed finding (a port, a disk, updates, services, a reboot, the
 * quorum). The other motifs are not compared word for word — Legion quotes
 * ssh's errors and recites fail2ban, Cénacle does neither (ADR-0040) — their
 * weight shows in the state. Counts are not compared (3 services here, 12
 * there is one finding on both sides): the finding is. Pure: two verdicts and the time, in; the
 * differences, out. A verdict missing, unreadable or too old for its own
 * source: thrown — the comparison could not run, it never says "no difference".
 */
import { createHash } from "node:crypto";
import { legionView, parseLegionVerdict } from "./parse-legion.ts";
import { CENACLE_STALE_MS } from "./ronde-source.ts";
import type { Observation } from "./types.ts";

export const COMPARE_CHECK = "ronde_comparaison";
export const DIFFERENCE = "ronde_ecart";

type Side = "legion" | "cenacle";
/** What the findings' table holds (017_securite_constats.sql). */
const MAX_OCCURRENCE = 60;

/** The difference's occurrence: readable when short, else a short print of the finding's own. */
function occurrenceOf(type: string, occurrence: string, side: Side): string {
  const full = `${type}:${occurrence}:${side}`;
  if (full.length <= MAX_OCCURRENCE) return full;
  const print = createHash("sha256").update(occurrence).digest("hex").slice(0, 12);
  return `${type}:#${print}:${side}`;
}
const WORDS: Readonly<Record<Side, string>> = { legion: "Legion", cenacle: "Cénacle" };

const difference = (host: string, occurrence: string, title: string): Observation => ({
  type: DIFFERENCE,
  target: host,
  occurrence,
  severity: "info",
  title: `${host} : ${title}`,
  params: { host },
});

interface Typed {
  readonly type: string;
  readonly occurrence: string;
  readonly words: string;
}

/** Each host's typed findings, keyed by kind and occurrence, with their words. */
function typed(observations: readonly Observation[]): Map<string, Map<string, Typed>> {
  const out = new Map<string, Map<string, Typed>>();
  for (const o of observations) {
    if (o.type === "serveur_autre") continue;
    const host = out.get(o.target) ?? new Map<string, Typed>();
    const words = o.title.slice(o.target.length + 3);
    host.set(`${o.type}:${o.occurrence}`, { type: o.type, occurrence: o.occurrence, words });
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
      const mine = found[side].get(host) ?? new Map<string, Typed>();
      const theirs = found[other].get(host) ?? new Map<string, Typed>();
      for (const [key, t] of mine) {
        if (theirs.has(key)) continue;
        out.push(
          difference(
            host,
            occurrenceOf(t.type, t.occurrence, side),
            `${t.words} — vu seulement par ${WORDS[side]}`,
          ),
        );
      }
    }
  }
  return out;
}
