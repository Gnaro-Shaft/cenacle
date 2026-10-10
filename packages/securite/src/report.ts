/**
 * The security agent's messages (J6a), in plain text for Telegram: each day,
 * only what changed (opened, resolved) — nothing at all when nothing changed;
 * each Monday, everything still open and every risk I accepted. Each finding
 * with the catalogue's advice and command; the CTO's comment marked as
 * AI-generated. Never longer than Telegram takes: what does not fit is counted.
 */
import { fixFor } from "./catalogue.ts";
import { type FindingKey, SEVERITY_LABEL, type Severity } from "./types.ts";

export const TELEGRAM_MAX = 4096;
export const AI_NOTICE =
  "🤖 Les commentaires du CTO sont générés par le modèle local (IA) : à vérifier.";
const ACCEPT_HINT = 'Accepter un risque : npm run securite -- accepter <n°> "raison"';

export interface ReportFinding extends FindingKey {
  readonly id: number;
  readonly severity: Severity;
  readonly title: string;
  readonly params: Readonly<Record<string, string>>;
  readonly firstSeen: Date;
  readonly comment?: string | null;
  /** When I said "I'm on it" (J6b), if I did. */
  readonly takenAt?: Date | null;
}

export interface AcceptedFinding extends ReportFinding {
  readonly reason: string;
  readonly acceptedAt: Date;
}

const ICON: Readonly<Record<Severity, string>> = {
  critique: "🔴",
  eleve: "🟠",
  moyen: "🟡",
  faible: "🔵",
  info: "⚪",
};

const day = (d: Date) =>
  new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "numeric",
    month: "long",
  }).format(d);
const heading = (d: Date) =>
  new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);

const RANK: Readonly<Record<Severity, number>> = {
  critique: 0,
  eleve: 1,
  moyen: 2,
  faible: 3,
  info: 4,
};
const worstFirst = <T extends ReportFinding>(list: readonly T[]) =>
  [...list].sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.id - b.id);

function openBlock(f: ReportFinding, withFix: boolean): string {
  const lines = [
    `${ICON[f.severity]} ${SEVERITY_LABEL[f.severity]} · ${f.title}`,
    `Constat n°${f.id}, depuis le ${day(f.firstSeen)}`,
  ];
  if (f.comment) lines.push(`💬 CTO : ${f.comment}`);
  if (withFix) {
    const fix = fixFor(f, f.params);
    lines.push(`✅ ${fix.advice}`);
    if (fix.command !== null) lines.push(`⌨ À lancer toi-même : ${fix.command}`);
  }
  return lines.join("\n");
}

/** Blocks under a head, within Telegram's limit; the notice and the hint always kept. */
function assemble(head: string, sections: readonly string[][], tail: readonly string[]): string {
  const footer = tail.length > 0 ? `\n\n${tail.join("\n")}` : "";
  const total = sections.reduce((n, s) => n + s.length, 0);
  const more = (n: number) =>
    `\n\n+ ${n} autre(s) constat(s), sans place ici : npm run securite -- constats`;
  const room = TELEGRAM_MAX - footer.length - more(total).length;
  let body = head.slice(0, room);
  let shown = 0;
  for (const blocks of sections) {
    for (const block of blocks) {
      const next = `${body}\n\n${block}`;
      if (next.length > room) return body + more(total - shown) + footer;
      body = next;
      shown += 1;
    }
  }
  return body + footer;
}

export interface DailyInput {
  readonly date: Date;
  readonly opened: readonly ReportFinding[];
  readonly resolved: readonly ReportFinding[];
  readonly openTotal: number;
}

/** Null when nothing changed: no message at all. */
export function formatDaily(input: DailyInput): string | null {
  if (input.opened.length === 0 && input.resolved.length === 0) return null;
  const head = [
    `🛡 Sécurité — ${heading(input.date)}`,
    `${input.opened.length} nouveau(x) constat(s), ${input.resolved.length} résolu(s) ; ${input.openTotal} ouvert(s) en tout.`,
  ].join("\n");
  const opened = worstFirst(input.opened).map((f) => openBlock(f, true));
  const resolved = input.resolved.map((f) => `✔ Résolu · ${f.title} (constat n°${f.id})`);
  const tail = [ACCEPT_HINT, ...(input.opened.some((f) => f.comment) ? [AI_NOTICE] : [])];
  return assemble(head, [opened, resolved], tail);
}

export interface WeeklyInput {
  readonly date: Date;
  readonly open: readonly ReportFinding[];
  readonly accepted: readonly AcceptedFinding[];
}

const STALE_TAKEN_MS = 7 * 24 * 3_600_000;

export function formatWeekly(input: WeeklyInput): string {
  const toFix = input.open.filter((f) => f.takenAt == null);
  const taken = input.open.filter((f) => f.takenAt != null);
  const head = [
    `🛡 Bilan sécurité de la semaine — ${heading(input.date)}`,
    input.open.length === 0
      ? "Aucun constat ouvert."
      : `${toFix.length} constat(s) à traiter, ${taken.length} pris en charge.`,
  ].join("\n");
  const open = [
    ...worstFirst(toFix).map((f) => openBlock({ ...f, comment: null }, true)),
    ...worstFirst(taken).map((f) => {
      const late = input.date.getTime() - (f.takenAt?.getTime() ?? 0) > STALE_TAKEN_MS;
      return `${late ? "⏰" : "🔧"} Pris en charge le ${day(f.takenAt ?? input.date)}${late ? ", toujours pas corrigé" : ""} · ${f.title} (constat n°${f.id})`;
    }),
  ];
  const accepted = input.accepted.map(
    (f) =>
      `☑ Accepté le ${day(f.acceptedAt)} · ${f.title} (constat n°${f.id}) — raison : ${f.reason}`,
  );
  return assemble(head, [open, accepted], input.open.length > 0 ? [ACCEPT_HINT] : []);
}
