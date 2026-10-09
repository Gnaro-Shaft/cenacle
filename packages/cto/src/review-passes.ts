/**
 * The review in focused passes (phase 6, J3b — ADR-0021). Left free, the CTO
 * scattered over neighbouring files and missed what mattered; now the code
 * prepares one dossier per changed code file — its own diff, the file after
 * the change (whole if short, else around the hunks), and the callers of the
 * names it exports — and asks fixed questions, one file at a time.
 */
import type { ReviewPass } from "./pipeline.ts";
import type { RepoView } from "./repo-view.ts";
import type { ReviewTarget } from "./review.ts";

/** The most changed code files are reviewed; the others are named. */
export const MAX_REVIEWED_FILES = 8;
const CODE = /\.(ts|tsx|js|mjs|sql|sh)$/;
const MAX_FILE_DIFF = 12_000;
const WHOLE_FILE_LINES = 300;
const CONTEXT_LINES = 30;
const MAX_CALLER_NAMES = 3;
const MAX_CALLERS = 6;

export const QUESTIONS = [
  "Une erreur est-elle avalée, ou une valeur de repli masque-t-elle un échec ?",
  "Processus, arrêts, relances, verrous, commandes système : un ordre ou une attente manque-t-il, une course est-elle possible ?",
  "Une donnée personnelle (adresse, nom, contenu de mail, hôte, compte) peut-elle finir dans un message, un journal, une erreur ou la console ?",
  "Texte venu de l'extérieur : encodage, jeux de caractères, caractères de contrôle, longueur — tout est-il traité ?",
  "Les tests prouvent-ils vraiment ce qu'ils disent (une mutation qui ne change rien, un cas toujours vrai, une assertion inatteignable) ?",
  "Une règle du projet (`docs/regles-du-code.md`) est-elle enfreinte ?",
];

/** Lines changed by a file's diff, to pick the most changed files. */
function churn(diff: string): number {
  return diff.split("\n").filter((l) => /^[+-](?![+-]{2})/.test(l)).length;
}

/** New-side line ranges of each hunk: `@@ -a,b +c,d @@`. */
function hunks(diff: string): Array<[number, number]> {
  return [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].map((m) => {
    const start = Number(m[1]);
    return [start, start + Number(m[2] ?? "1") - 1];
  });
}

/** The file after the change: whole if short, else numbered windows around the hunks. */
function excerpt(text: string, diff: string): string {
  const lines = text.split("\n");
  const numbered = (from: number, to: number) =>
    lines
      .slice(from - 1, to)
      .map((l, i) => `${from + i}: ${l}`)
      .join("\n");
  if (lines.length <= WHOLE_FILE_LINES) return numbered(1, lines.length);
  const windows: Array<[number, number]> = [];
  for (const [a, b] of hunks(diff)) {
    const from = Math.max(1, a - CONTEXT_LINES);
    const to = Math.min(lines.length, b + CONTEXT_LINES);
    const last = windows.at(-1);
    if (last !== undefined && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else windows.push([from, to]);
  }
  return windows.map(([a, b]) => numbered(a, b)).join("\n…\n");
}

/** Names the change exports, and where else they are used at this version. */
function callers(path: string, diff: string, view: RepoView): string {
  const names = [
    ...new Set(
      [
        ...diff.matchAll(
          /^\+\s*export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z_]\w{2,})/gm,
        ),
      ].map((m) => m[1] ?? ""),
    ),
  ].slice(0, MAX_CALLER_NAMES);
  const lines: string[] = [];
  for (const name of names) {
    const hits = view
      .search(name, MAX_CALLERS + 2)
      .filter((h) => !h.startsWith(`${path}:`))
      .slice(0, MAX_CALLERS);
    lines.push(
      hits.length === 0 ? `${name} : utilisé nulle part ailleurs` : `${name} :\n${hits.join("\n")}`,
    );
  }
  return lines.length === 0 ? "(aucun nom exporté par ce changement)" : lines.join("\n");
}

export function buildPasses(
  target: ReviewTarget,
  view: RepoView,
): { readonly passes: ReviewPass[]; readonly skipped: readonly string[] } {
  const code = target.parts
    .filter((p) => CODE.test(p.path))
    .sort((a, b) => churn(b.diff) - churn(a.diff));
  const chosen = code.slice(0, MAX_REVIEWED_FILES);
  const skipped = [
    ...code.slice(MAX_REVIEWED_FILES).map((p) => p.path),
    ...target.parts.filter((p) => !CODE.test(p.path)).map((p) => p.path),
  ];
  const passes: ReviewPass[] = [];
  for (const { path, diff } of chosen) {
    let after: string;
    try {
      after = excerpt(view.read(path), diff);
    } catch {
      after = "(fichier supprimé, ou illisible pour le CTO)";
    }
    passes.push({
      label: path,
      prompt: [
        `Relis UN fichier du changement « ${target.label} » : \`${path}\`. Les autres fichiers ont leur propre passe : ne parle que de celui-ci.`,
        "Pose-toi ces questions, une par une :",
        ...QUESTIONS.map((q, i) => `${i + 1}. ${q}`),
        `Pour chaque défaut réel : sa gravité (bloquant, important ou mineur), \`${path}:ligne\` (le chemin complet), pourquoi c'est un défaut, et le test qui l'attraperait. Pas de remarque de style. Si tu ne trouves rien de réel, réponds exactement « Aucun défaut dans ce fichier. »`,
        "",
        "DIFF DE CE FICHIER :",
        diff.length > MAX_FILE_DIFF ? `${diff.slice(0, MAX_FILE_DIFF)}\n… (diff coupé)` : diff,
        "",
        "LE FICHIER APRÈS LE CHANGEMENT (lignes numérotées) :",
        after,
        "",
        "APPELANTS DES NOMS EXPORTÉS :",
        callers(path, diff, view),
      ].join("\n"),
    });
  }
  return { passes, skipped };
}
