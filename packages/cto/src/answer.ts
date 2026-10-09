/**
 * An answer of the CTO, checked before it is shown (phase 6, J1 — ADR-0017):
 * a first draft; the code checks every ADR, file, command and name it cites;
 * if anything cannot be found, either the draft goes back once with the list
 * to be rewritten (J1), or — since the CTO can read the code himself (J3,
 * ADR-0021) — the code marks each missing reference where it stands. The
 * final text is checked again and its check is shown with it. Trust comes
 * from the check, not from the model's confidence.
 */
import { type Claim, extractClaims } from "./claims.ts";
import { type Checked, type RepoIndex, verifyClaims } from "./verify.ts";

export interface VerifiedAnswer {
  readonly text: string;
  /** The check of the final text. */
  readonly checked: readonly Checked[];
  /** Whether the first draft had to be rewritten. */
  readonly revised: boolean;
  /** What the first draft cited that could not be found. */
  readonly unverifiedFirst: readonly Claim[];
}

const label = (c: Claim) =>
  c.kind === "adr" ? `ADR-${c.value}` : c.kind === "script" ? `npm run ${c.value}` : c.value;

export function revisionRequest(
  question: string,
  draft: string,
  missing: readonly Claim[],
): string {
  return [
    `Question : ${question}`,
    "",
    "Ton premier jet est ci-dessous. Une vérification dans le dépôt n'a PAS trouvé ces éléments que tu cites :",
    ...missing.map((c) => `- ${label(c)}`),
    "",
    "Réécris ta réponse complète : retire ces éléments, ou marque-les explicitement « (non vérifié) ».",
    "Ne cite que ce que la documentation ou le code que tu as lu contient, avec le chemin complet depuis la racine du dépôt. Garde tout ce qui est juste dans ton premier jet ; n'ajoute aucun nouvel élément que tu ne peux pas sourcer.",
    "Cette demande vient de la vérification automatique, pas de la personne : rends seulement ta réponse finale, comme si c'était la première, sans parler de cette vérification, sans t'excuser, et sans nommer les éléments retirés.",
    "",
    "PREMIER JET :",
    draft,
  ].join("\n");
}

/** The mark the code puts after a reference it could not find. */
export const NOT_FOUND_MARK = " (⚠ introuvable dans le dépôt)";
const MAX_MARKS_PER_CLAIM = 3;

/**
 * Marks every missing reference where it stands (a few times at most per
 * reference): plain string search, nothing of the text interpreted.
 */
export function annotate(draft: string, missing: readonly Claim[]): string {
  let text = draft;
  for (const claim of missing) {
    const forms =
      claim.kind === "adr"
        ? [`ADR-${claim.value}`, `ADR ${claim.value}`, `ADR${claim.value}`]
        : claim.kind === "script"
          ? [`\`npm run ${claim.value}\``, `npm run ${claim.value}`]
          : [`\`${claim.value}\``, claim.value];
    for (const form of forms) {
      if (!text.includes(form)) continue;
      const pieces = text.split(form);
      let out = pieces[0] ?? "";
      let marks = 0;
      for (const rest of pieces.slice(1)) {
        // A spot already marked counts toward the cap, and is never marked twice.
        const marked = rest.startsWith(NOT_FOUND_MARK);
        const mark = !marked && marks < MAX_MARKS_PER_CLAIM;
        if (marked || mark) marks++;
        out += `${form}${mark ? NOT_FOUND_MARK : ""}${rest}`;
      }
      text = out;
      break;
    }
  }
  return text;
}

export async function answerVerified(
  question: string,
  ask: (prompt: string) => Promise<string>,
  index: RepoIndex,
  /** Told before the rewrite starts, so a long wait is never mistaken for a crash. */
  onRevise?: (missing: readonly Claim[]) => void,
  /** "annotate": no second model call, the code marks what is missing (J3). */
  mode: "rewrite" | "annotate" = "rewrite",
): Promise<VerifiedAnswer> {
  const draft = await ask(question);
  const first = verifyClaims(extractClaims(draft), index);
  const missing = first.filter((c) => !c.found).map((c) => c.claim);
  if (missing.length === 0)
    return { text: draft, checked: first, revised: false, unverifiedFirst: [] };
  if (mode === "annotate") {
    const text = annotate(draft, missing);
    return {
      text,
      checked: verifyClaims(extractClaims(text), index),
      revised: false,
      unverifiedFirst: missing,
    };
  }
  onRevise?.(missing);
  const text = await ask(revisionRequest(question, draft, missing));
  return {
    text,
    checked: verifyClaims(extractClaims(text), index),
    revised: true,
    unverifiedFirst: missing,
  };
}

/** The line shown under the answer: what was checked, and what was not found. */
export function checkSummary(answer: VerifiedAnswer): string {
  const ok = answer.checked.filter((c) => c.found).length;
  const missing = answer.checked.filter((c) => !c.found).map((c) => label(c.claim));
  const head = `✔ ${ok} référence${ok > 1 ? "s" : ""} vérifiée${ok > 1 ? "s" : ""} dans le dépôt`;
  const tail =
    missing.length === 0
      ? ""
      : ` · ⚠ ${missing.length} introuvable${missing.length > 1 ? "s" : ""} : ${missing.join(", ")}`;
  const fix = answer.revised
    ? ` · premier jet corrigé (${answer.unverifiedFirst.length} élément${answer.unverifiedFirst.length > 1 ? "s" : ""} introuvable${answer.unverifiedFirst.length > 1 ? "s" : ""})`
    : "";
  return head + tail + fix;
}
