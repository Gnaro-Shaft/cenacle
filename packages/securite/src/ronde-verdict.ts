/**
 * The ronde's verdict, in Legion's exact format (ADR-0040, R2), so that the
 * security agent and the operator read it as they read Legion's
 * (parse-legion.ts): `etat=`, `instant=` in seconds, `hotes=` the number of
 * machines, then each machine's `<nom>.etat=` and `<nom>.motifN=`, `fin=1`.
 * Pure: the file is written whole by the ronde (apps/ronde).
 */
import { type HostVerdict, worstState } from "./ronde-rules.ts";

/** Where the ronde leaves its verdict, overwritten at every pass. */
export const RONDE_VERDICT_PATH =
  process.env.RONDE_VERDICT_PATH ??
  `${process.env.HOME ?? ""}/Library/Caches/fr.gnaro.cenacle.ronde.verdict`;

export interface NamedVerdict extends HostVerdict {
  readonly name: string;
}

/** The verdict's text, Legion's `rediger`: hosts in the order given, one line per fact. */
export function verdictText(hosts: readonly NamedVerdict[], instantSeconds: number): string {
  if (hosts.length === 0) throw new Error("a verdict names at least one machine");
  const lines = [
    `etat=${worstState(hosts.map((h) => h.state))}`,
    `instant=${instantSeconds}`,
    `hotes=${hosts.length}`,
  ];
  for (const host of hosts) {
    lines.push(`${host.name}.etat=${host.state}`);
    host.motifs.forEach((motif, i) => {
      // A line break would end the motif and start a forged line: Legion turns it into a space.
      lines.push(`${host.name}.motif${i + 1}=${motif.replaceAll("\n", " ")}`);
    });
  }
  lines.push("fin=1");
  return `${lines.join("\n")}\n`;
}
