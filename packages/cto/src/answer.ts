/**
 * An answer of the CTO, checked before it is shown (phase 6, J1 — ADR-0017):
 * a first draft; the code checks every ADR, file, command and name it cites;
 * if anything cannot be found, the draft goes back once with the list, to be
 * rewritten without it or with it marked "non vérifié"; the final answer is
 * checked again and its check is shown with it. Trust comes from the check,
 * not from the model's confidence.
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
    "Ne cite que ce que la documentation contient. N'ajoute aucun nouvel élément que tu ne peux pas sourcer.",
    "",
    "PREMIER JET :",
    draft,
  ].join("\n");
}

export async function answerVerified(
  question: string,
  ask: (prompt: string) => Promise<string>,
  index: RepoIndex,
): Promise<VerifiedAnswer> {
  const draft = await ask(question);
  const first = verifyClaims(extractClaims(draft), index);
  const missing = first.filter((c) => !c.found).map((c) => c.claim);
  if (missing.length === 0)
    return { text: draft, checked: first, revised: false, unverifiedFirst: [] };
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
