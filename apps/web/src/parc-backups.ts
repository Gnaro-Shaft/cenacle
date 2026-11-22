/**
 * The Parc's « Sauvegardes » section (ADR-0043, S2b), pure: one line per
 * machine and source, in the ronde's words — the page never judges again.
 * A source nobody declared is shown grey, never judged, never red. A machine
 * that declares sources and could not be read: its backups are unknown,
 * never green. Never a motif's text: their number, and the command that
 * reads them on the server.
 */
import type { BackupView, ParcView } from "./api.ts";
import { ago, type Tone } from "./parc-rules.ts";

export interface BackupLine {
  readonly machine: string;
  /** Null for a line about the machine's bulletin, not one source. */
  readonly source: string | null;
  readonly tone: Tone;
  readonly words: string;
  /** Declared and judged by the ronde; false for a source shown only. */
  readonly judged: boolean;
  /** Where to read its motifs, on the server; null when there is nothing to read. */
  readonly command: string | null;
}

/**
 * The sources the bulletin may recite (deploy/serveurs/cenacle-bulletin):
 * a command is only ever built for one of these, whatever the file says.
 */
const SOURCES: readonly string[] = [
  "copie-dumps",
  "veiller-sauvegardes",
  "copie-bases",
  "myriade-base",
  "copie-cenacle",
];
const commandFor = (source: string) =>
  SOURCES.includes(source) ? `cat /var/lib/${source}/verdict` : null;

const when = (ms: number | null, now: number) =>
  ms === null ? "à une date inconnue" : ago(new Date(ms).toISOString(), now);
const motifs = (n: number | null) =>
  n === null || n === 0 ? "" : ` · ${n} motif${n > 1 ? "s" : ""}`;

function judgedLine(machine: string, b: BackupView, now: number): BackupLine {
  const line = (tone: Tone, words: string): BackupLine => ({
    machine,
    source: b.source,
    tone,
    words,
    judged: true,
    command: tone === "bon" ? null : commandFor(b.source),
  });
  switch (b.judgment) {
    case "sain":
      return line("bon", `saine, verdict ${when(b.at, now)}`);
    case "malade":
      return line("mauvais", `MALADE, tombée ${when(b.since ?? b.at, now)}${motifs(b.motifs)}`);
    case "illisible":
      return line("mauvais", "verdict illisible");
    case "absente":
      return line("mauvais", "sans verdict sur la machine");
    case "perimee":
      return line("mauvais", `sans verdict depuis 36 h (le dernier ${when(b.at, now)})`);
    case "future":
      return line("mauvais", "verdict daté du futur : horloge fausse, ou verdict forgé");
    default:
      return line("inconnu", "état inconnu");
  }
}

function shownLine(machine: string, b: BackupView, now: number): BackupLine {
  const said = b.verdict === null ? "illisible" : `${b.verdict} ${when(b.at, now)}`;
  return {
    machine,
    source: b.source,
    tone: "inconnu",
    words: `non attendue, montrée sans être jugée : ${said}`,
    judged: false,
    command: null,
  };
}

type MachineEntry = NonNullable<ParcView["machines"]>["machines"][number];

function linesOf(m: MachineEntry, now: number): BackupLine[] {
  if (m.read !== "ok") {
    return m.declared.map((source) => ({
      machine: m.name,
      source,
      tone: "inconnu" as const,
      words: "inconnue : le bulletin n'a pas été lu",
      judged: true,
      command: null,
    }));
  }
  if (m.backups === null) {
    if (m.declared.length === 0) return [];
    return [
      {
        machine: m.name,
        source: null,
        tone: "mauvais",
        words: "bulletin trop ancien pour réciter les sauvegardes (version 3, deploy/serveurs)",
        judged: true,
        command: null,
      },
    ];
  }
  return m.backups.map((b) =>
    b.judgment === "non-declaree" ? shownLine(m.name, b, now) : judgedLine(m.name, b, now),
  );
}

export interface BackupsSection {
  /** What keeps the lines from being believed, when anything does. */
  readonly note: string | null;
  readonly tone: Tone;
  readonly lines: readonly BackupLine[];
}

const RANK: Readonly<Record<Tone, number>> = { bon: 0, inconnu: 1, attention: 2, mauvais: 3 };

/**
 * The section: its lines, and its frame — the worst of the judged lines; an
 * old ronde or nothing judged, unknown. A source shown only never colours it.
 */
export function backupsSection(view: ParcView, now: number): BackupsSection {
  const m = view.machines;
  if (m === null || m.ronde !== "ok") {
    return {
      note: "La ronde n'est pas lue : l'état des sauvegardes est inconnu.",
      tone: "inconnu",
      lines: [],
    };
  }
  const read = m.machines.flatMap((x) => linesOf(x, now));
  // An old ronde says nothing of today: every line unknown, never green, never red.
  const lines = m.stale ? read.map((l) => ({ ...l, tone: "inconnu" as const })) : read;
  const judged = lines.filter((l) => l.judged).map((l) => l.tone);
  const worst = judged.reduce<Tone>((a, b) => (RANK[b] > RANK[a] ? b : a), "bon");
  const note = m.stale
    ? "La ronde est trop ancienne : ces états ne disent plus rien d'aujourd'hui."
    : lines.length === 0
      ? "Aucune sauvegarde déclarée dans parc.local.toml, ni récitée par un bulletin."
      : null;
  return { note, tone: m.stale || judged.length === 0 ? "inconnu" : worst, lines };
}
