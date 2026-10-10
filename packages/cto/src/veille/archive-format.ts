/**
 * The veille's archive as Markdown (npm run veille:archive), ready to reuse in
 * an article, a post or a note: grouped by day, newest first. Scores,
 * summaries and ideas are AI-generated, and the text says so at the top, so
 * that a later reuse never takes them for checked facts.
 */
import type { ArchivedArticle } from "@cenacle/journal";

export const ARCHIVE_NOTICE =
  "> Résumés, notes et idées générés par le modèle local (IA) lors de la veille : des pistes à vérifier, pas des faits.";

const dayOf = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));

/** A Markdown line never broken by what a feed wrote: no line breaks, no brackets that close a link. */
const inline = (s: string) => s.replace(/\s+/g, " ").replace(/[[\]]/g, (c) => `\\${c}`);
/** A link target never closed early by a parenthesis or a blank. */
const target = (s: string) =>
  s.replace(/[()\s<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);

export function archiveMarkdown(
  articles: readonly ArchivedArticle[],
  filters: { readonly since?: string; readonly project?: string; readonly text?: string } = {},
): string {
  const asked = [
    filters.since === undefined ? null : `depuis le ${filters.since}`,
    filters.project === undefined ? null : `projet ${inline(filters.project)}`,
    filters.text === undefined ? null : `« ${inline(filters.text)} »`,
  ].filter((x) => x !== null);
  const lines = [
    `# Veille du CTO${asked.length > 0 ? ` — ${asked.join(", ")}` : ""}`,
    "",
    ARCHIVE_NOTICE,
    "",
  ];
  if (articles.length === 0) return [...lines, "Aucun article archivé ne correspond."].join("\n");
  let day = "";
  for (const a of articles) {
    const d = dayOf(a.sentAt);
    if (d !== day) {
      lines.push(`## ${d}`, "");
      day = d;
    }
    const kind = a.theme === "version" ? ", notes de version" : "";
    lines.push(
      `- **[${inline(a.title)}](${target(a.link)})** — ${inline(a.source)}${kind}, ${a.score}/10`,
    );
    if (a.resume !== null) lines.push(`  ${inline(a.resume)}`);
    if (a.project !== null && a.idea !== null) {
      lines.push(`  👉 Pour ${inline(a.project)} : ${inline(a.idea)}`);
    }
  }
  lines.push("", `${articles.length} article(s).`);
  return lines.join("\n");
}
