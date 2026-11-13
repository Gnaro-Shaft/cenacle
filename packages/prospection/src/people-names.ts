/**
 * No person's name on a card (lot D, 13/11). The model is told never to write
 * one (extract.ts, application.ts), and cleanField already removes e-mail
 * addresses, phone numbers and @accounts. That left a name to the model's
 * good will. Now the code reads the names the alert presents as a person and
 * removes them, whole, from the card's title, company and place.
 *
 * Careful by design (D2 review): a card damaged in silence is worse than a
 * name missed, and the notice says the filter is not infallible. So:
 * - only labels that always introduce a person count — « Recruteuse : »,
 *   « Interlocuteur : », « Publiée par » —, never « Contact : » (often a
 *   company or a team) nor « Consultant » (a job title);
 * - a separator is required (a colon, or « par »), the name on the same line;
 * - the name has the shape of a first name and a name: two or three words,
 *   each capitalised (« Marie-Anne Martin », « Jean DUPONT »);
 * - only the whole name, in sequence, is removed — never one of its words
 *   elsewhere (« Pierre » stays in « Pierre & Vacances »).
 */
import { normalized } from "./text.ts";

const LABEL =
  "(?<![\\p{L}\\p{N}])(?:(?:recrut(?:eur|euse)|recruiter|charg[ée]e? de recrutement|talent acquisition(?: partner| manager)?|account manager|business manager|ing[ée]nieure? d'affaires|interlocut(?:eur|rice))\\s*[:：]|(?:publi|propos|post)[ée]e? par)";
const LABELS = new RegExp(LABEL, "giu");
/**
 * Two or three capitalised words on the same line. Read apart from the label,
 * case-sensitive: with the `i` flag, `\p{Lu}` would also take lower case.
 */
const WORD = "\\p{Lu}[\\p{Ll}'’]+(?:-\\p{Lu}[\\p{Ll}'’]+)?|\\p{Lu}{2,}(?:-\\p{Lu}{2,})?";
const NAME = new RegExp(`[ \\t]*((?:${WORD})(?:[ \\t]+(?:${WORD})){1,2})(?![\\p{L}\\p{N}])`, "uy");

/** The names the alert presents as a person, normalised, each as its words. */
export function presentedNames(text: string): string[][] {
  const names: string[][] = [];
  for (const label of text.matchAll(LABELS)) {
    NAME.lastIndex = label.index + label[0].length;
    const name = NAME.exec(text)?.[1];
    if (name !== undefined) names.push(normalized(name).split(" "));
  }
  return names;
}

/** A field without those names, each removed only where it stands whole; null when nothing is left. */
export function withoutNames(field: string | null, names: readonly string[][]): string | null {
  if (field === null || names.length === 0) return field;
  const words = field.split(/\s+/);
  const keys = words.map((w) => normalized(w));
  const drop = new Set<number>();
  for (const name of names) {
    const flat = name.join(" ");
    for (let i = 0; i < words.length; i++) {
      // A run of words that, joined, normalise to the name ("JEAN-DUPONT", "Jean Dupont,").
      for (let j = i; j < words.length && j < i + name.length; j++) {
        if (keys.slice(i, j + 1).join(" ") === flat) {
          for (let k = i; k <= j; k++) drop.add(k);
        }
      }
    }
  }
  if (drop.size === 0) return field;
  const text = words
    .filter((_, i) => !drop.has(i))
    .join(" ")
    .replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, "");
  return text === "" ? null : text;
}

export interface Named {
  readonly title: string;
  readonly company: string | null;
  readonly place: string | null;
}

/** The offer without the alert's presented names; null when its title was only a name. */
export function offerWithoutNames<T extends Named>(offer: T, text: string): T | null {
  const names = presentedNames(text);
  if (names.length === 0) return offer;
  const title = withoutNames(offer.title, names);
  if (title === null) return null;
  return {
    ...offer,
    title,
    company: withoutNames(offer.company, names),
    place: withoutNames(offer.place, names),
  };
}
