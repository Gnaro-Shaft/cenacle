/**
 * The ronde's verdict, in Legion's exact format (ADR-0040, R2), so that the
 * security agent and the operator read it as they read Legion's
 * (parse-legion.ts): `etat=`, `instant=` in seconds, `hotes=` the number of
 * machines, then each machine's `<nom>.etat=` and `<nom>.motifN=`, `fin=1`.
 * Pure: the file is written whole by the ronde (apps/ronde).
 */
import { VERDICT_MOTIF } from "./parse-legion.ts";
import { type HostVerdict, worstState } from "./ronde-rules.ts";

/** The reader takes motif1 to motif99. */
const MAX_MOTIFS = 99;
const OUT_OF_SHAPE = "motif hors forme — non recopie";
const TOO_MANY = "motifs trop nombreux — les suivants non recopies";

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
    const motifs =
      host.motifs.length > MAX_MOTIFS
        ? [...host.motifs.slice(0, MAX_MOTIFS - 1), TOO_MANY]
        : host.motifs;
    motifs.forEach((motif, i) => {
      // A line break would end the motif and start a forged line: Legion turns it into a space.
      const flat = motif.replaceAll("\n", " ");
      // A motif the reader would refuse would make the whole verdict unreadable: said in fixed words.
      lines.push(`${host.name}.motif${i + 1}=${VERDICT_MOTIF.test(flat) ? flat : OUT_OF_SHAPE}`);
    });
  }
  lines.push("fin=1");
  return `${lines.join("\n")}\n`;
}
