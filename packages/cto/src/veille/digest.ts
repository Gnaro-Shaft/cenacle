/**
 * The veille's message, in plain text (Telegram shows it as written, no
 * markup to inject): the articles kept, best first, each with its summary and
 * what it could bring to one of my projects; the sources that failed; and,
 * always, that summaries and ideas come from the local model (AI Act, art. 50).
 * Never longer than Telegram takes: what does not fit is counted, not cut.
 */
import type { FeedItem } from "./feeds.ts";
import type { Scored } from "./score.ts";

export const TELEGRAM_MAX = 4096;
export const AI_NOTICE =
  "🤖 Résumés, notes et idées générés par le modèle local (IA) : des pistes à vérifier, pas des faits.";

export interface Kept {
  readonly item: FeedItem;
  readonly scored: Scored;
}

export interface DigestInput {
  readonly date: Date;
  readonly scanned: number;
  readonly kept: readonly Kept[];
  readonly failed: readonly string[];
  readonly threshold: number;
  /** The projects are the fictional example (no veille.local.toml). */
  readonly exampleProjects?: boolean;
}

const dayOf = (d: Date) =>
  new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);

function badge(score: number): string {
  if (score >= 9) return "🔥";
  if (score >= 8) return "⭐";
  return "📌";
}

function block({ item, scored }: Kept): string {
  const lines = [
    `${badge(scored.score)} ${scored.score}/10 · ${item.source}${item.theme === "version" ? " (notes de version)" : ""}`,
    item.title,
    item.link,
  ];
  if (scored.resume !== null) lines.push(scored.resume);
  if (scored.project !== null && scored.idea !== null) {
    lines.push(`👉 Pour ${scored.project} : ${scored.idea}`);
  }
  return lines.join("\n");
}

const leftOut = (n: number) => `\n\n+ ${n} autre(s) retenu(s), sans place ici.`;

export interface Digest {
  readonly text: string;
  /** The articles the message really shows: only they are archived as sent. */
  readonly shown: readonly Kept[];
}

export function formatDigest(input: DigestInput): Digest {
  const head = [`📰 Veille du CTO — ${dayOf(input.date)}`];
  head.push(
    input.kept.length === 0
      ? `Rien de saillant : ${input.scanned} article(s) lu(s), aucun noté ${input.threshold} ou plus.`
      : `${input.kept.length} article(s) retenu(s) sur ${input.scanned} lu(s).`,
  );
  if (input.failed.length > 0) head.push(`⚠ Sources injoignables : ${input.failed.join(", ")}.`);
  if (input.exampleProjects === true) {
    head.push("ℹ Projets fictifs : crée veille.local.toml pour des idées sur tes vrais projets.");
  }
  const footer = `\n\n${AI_NOTICE}`;
  // The notice is never cut: the body makes room for it, and for the count.
  const room = TELEGRAM_MAX - footer.length - leftOut(input.kept.length).length;
  let body = head.join("\n").slice(0, room);
  const shown: Kept[] = [];
  for (const kept of input.kept) {
    const next = `${body}\n\n${block(kept)}`;
    if (next.length > room) break;
    body = next;
    shown.push(kept);
  }
  const left = input.kept.length - shown.length;
  return { text: body + (left > 0 ? leftOut(left) : "") + footer, shown };
}
