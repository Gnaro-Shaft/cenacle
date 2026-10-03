/**
 * Is there an urgency term in a subject? (ADR-0007)
 *
 * A closed list, compared without case or accents, on whole words, without
 * any model. It is only one half of the rule: an alert also needs the mail to
 * be sorted "clients_prospects" — a promotion shouting URGENT stays noise.
 */

export const URGENT_TERMS = [
  "urgent",
  "urgence",
  "asap",
  "au plus vite",
  "dès que possible",
] as const;

function normalize(text: string): string {
  return ` ${text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

const NORMALIZED_TERMS = URGENT_TERMS.map((term) => normalize(term));

export function hasUrgentTerm(subject: string | null | undefined): boolean {
  if (typeof subject !== "string" || subject.length === 0) return false;
  const text = normalize(subject.slice(0, 1000));
  return NORMALIZED_TERMS.some((term) => text.includes(term));
}
