/**
 * The article 9 floor (phase 5, C2): what the model must never read.
 *
 * GDPR art. 9 forbids, in principle, processing data revealing racial or
 * ethnic origin, political opinions, religious or philosophical beliefs,
 * trade-union membership, health, sex life or sexual orientation, and genetic
 * or biometric data; art. 10 adds criminal convictions. A mail that seems to
 * reveal one is set aside BEFORE any model sees it. Ported from Legion's floor
 * (legion/cadre/sensible.py), tuned for mails.
 *
 * Three deliberate choices:
 * 1. No model decides: the decision must be reproducible and impossible to
 *    influence by what it examines.
 * 2. The list is not exhaustive and never will be. It lowers a risk without
 *    removing it; saying so is more honest than pretending otherwise.
 * 3. Wrongly setting aside is preferred: a false positive costs a mail I sort
 *    by hand; a false negative feeds the model what we forbade ourselves.
 *
 * The decision is never stored: writing down that a mail is about health
 * would itself record health data. Callers only learn "set aside or not".
 */

/** Words compared WHOLE (a short term as a substring would catch anything). */
const TERMS: Readonly<Record<string, ReadonlySet<string>>> = {
  sante: new Set([
    "sante",
    "medical",
    "medicale",
    "medicaux",
    "medecin",
    "maladie",
    "diagnostic",
    "ordonnance",
    "hopital",
    "hospitalisation",
    "clinique",
    "psy",
    "psychiatrie",
    "psychologue",
    "therapie",
    "handicap",
    "invalidite",
    "grossesse",
    "vaccin",
    "vaccination",
    "radiologie",
    "cardiologie",
    "oncologie",
    "cancer",
    "vih",
    "sida",
    "depression",
    "burnout",
    "mutuelle",
  ]),
  // "iris" (Legion's list) is left out on purpose: it is the agent's name.
  "genetique-biometrie": new Set([
    "adn",
    "genome",
    "genetique",
    "empreintes",
    "biometrie",
    "biometrique",
    "faciale",
  ]),
  // "parti", "politique" and "vote" are left out on purpose: in mails they are
  // mostly "je suis parti", "politique de confidentialité", "votez pour…".
  opinions: new Set([
    "militant",
    "militante",
    "election",
    "syndicat",
    "syndicale",
    "syndical",
    "greve",
    "cgt",
    "cfdt",
  ]),
  convictions: new Set([
    "religion",
    "religieuse",
    "religieux",
    "eglise",
    "mosquee",
    "synagogue",
    "temple",
    "priere",
    "bapteme",
    "confession",
  ]),
  origine: new Set([
    "ethnie",
    "ethnique",
    "nationalite",
    "immigration",
    "refugie",
    "refugiee",
    "asile",
  ]),
  "vie-sexuelle": new Set(["sexualite", "sexuelle", "lgbt", "homosexualite"]),
  condamnations: new Set([
    "condamnation",
    "casier",
    "judiciaire",
    "penal",
    "penale",
    "infraction",
    "prison",
  ]),
};

/** Families where the root is enough: the derived forms are too many to list. */
const ROOTS: Readonly<Record<string, readonly string[]>> = {
  sante: ["medicament", "pathologi", "symptom", "therapeut"],
  condamnations: ["condamn"],
};

const plainOf = (text: string) => text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** Words of a text, without case or accents: "Santé", "SANTE" and "sante_2026" are one word. */
function wordsOf(text: string): string[] {
  const plain = plainOf(text);
  const words = plain.match(/[a-z0-9]+/g) ?? [];
  // A hyphenated word is also read whole: "burn-out" is "burnout".
  const compounds = (plain.match(/[a-z0-9]+(?:-[a-z0-9]+)+/g) ?? []).map((w) =>
    w.replace(/-/g, ""),
  );
  return [...words, ...compounds];
}

/**
 * Single letters spaced or dotted to dodge the floor ("s a n t é",
 * "M.É.D.I.C.A.L.E"), joined back. A run starts and ends on a lone letter: it
 * never borrows a letter from the word before or after.
 */
function joinedSpelling(text: string): string[] {
  const runs = text.match(/(?<!\p{L})(?:\p{L}[\s.\-_*]+){2,}\p{L}(?!\p{L})/gu) ?? [];
  return runs.flatMap((run) => wordsOf(run.replace(/[\s.\-_*]/g, "")));
}

/** The category a text seems to reveal, or null. Pure: it records nothing. */
export function sensitiveCategory(text: string): string | null {
  for (const word of [...wordsOf(text), ...joinedSpelling(text)]) {
    for (const [category, terms] of Object.entries(TERMS)) {
      if (terms.has(word)) return category;
    }
    for (const [category, roots] of Object.entries(ROOTS)) {
      if (roots.some((root) => word.startsWith(root))) return category;
    }
  }
  return null;
}

/** Whether a mail must be set aside before any model reads it. */
export function revealsSpecialCategory(mail: {
  readonly subject: string;
  readonly text: string;
}): boolean {
  return sensitiveCategory(`${mail.subject}\n${mail.text}`) !== null;
}

/** Thrown when a sensitive mail reaches a model anyway: the second line of defence. */
export class SensitiveMailError extends Error {
  constructor() {
    super("a mail set aside by the article 9 floor reached the model");
    this.name = "SensitiveMailError";
  }
}

/** For the model's own entry points: refuse, never read. */
export function assertNotSensitive(mail: {
  readonly subject: string;
  readonly text: string;
}): void {
  if (revealsSpecialCategory(mail)) throw new SensitiveMailError();
}
