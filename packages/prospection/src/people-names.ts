/**
 * No person's name on a card (lot D, 13/11). The model is told never to write
 * one (extract.ts, application.ts), and cleanField already removes e-mail
 * addresses, phone numbers and @accounts. That left a name to the model's
 * good will: the notice promised more than the code held. Now the code reads
 * the names the alert itself presents as a person — after « Contact », «
 * Recruteur », « Consultante »… — and removes them from the card's title,
 * company and place. A name the alert does not present that way can still
 * pass: the notice says so.
 */
import { normalized } from "./text.ts";

/**
 * A label that, in an alert, introduces a person: a role then a separator
 * (« Contact : », « Recruteuse – »), or « publiée par ». Never a role word
 * alone: « Consultante Java Senior » is a job title, not a person.
 */
const LABEL =
  "(?:(?:contact|interlocut(?:eur|rice)|recrut(?:eur|euse)|recruiter|charg[ée]e? de recrutement|consultante?|talent(?: acquisition)?(?: partner| manager)?|account manager|business manager|ing[ée]nieure? d'affaires|r[ée]f[ée]rente?)\\s*[:：–-]|(?:publi|propos|post)[ée]e? par)";
/**
 * One to three capitalised words on the same line, as a first name and a name
 * are written. Read apart from the label, case-sensitive: with the `i` flag,
 * `\\p{Lu}` would also take lower case (« contact: support »).
 */
const NAME = /[ \t]*(?:\r?\n[ \t]*)?((?:\p{Lu}[\p{L}'’-]+\.?[ \t]+){0,2}\p{Lu}[\p{L}'’-]*\.?)/uy;
const LABELS = new RegExp(LABEL, "giu");

/** The names the alert presents as a person, normalised, each as its words. */
export function presentedNames(text: string): string[][] {
  const names: string[][] = [];
  for (const label of text.matchAll(LABELS)) {
    NAME.lastIndex = label.index + label[0].length;
    const name = NAME.exec(text)?.[1];
    if (name === undefined) continue;
    const words = normalized(name)
      .split(" ")
      .filter((w) => w.length >= 2);
    if (words.length > 0) names.push(words);
  }
  return names;
}

/** A field without any word of those names; null when nothing is left. */
export function withoutNames(field: string | null, names: readonly string[][]): string | null {
  if (field === null || names.length === 0) return field;
  const banned = new Set(names.flat());
  const kept = field.split(/\s+/).filter(
    (word) =>
      !normalized(word)
        .split(" ")
        .some((w) => banned.has(w)),
  );
  const text = kept.join(" ").replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, "");
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
