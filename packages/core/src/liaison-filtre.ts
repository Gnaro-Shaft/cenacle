/**
 * The text of a demand to the house (ADR-0048, T-12), checked as the house
 * checks it (its `liaison_filtre.py`, docs/liaison.md of its repository) —
 * before the database, at each edit, and again before handing it over.
 *
 * The filter is wide on purpose: a false positive costs me a sentence to
 * rewrite; a false negative would send a third party's data to a model abroad.
 * A refusal names the category, never the value found. Names of people are not
 * detected here, nor by the house: my reading stops them.
 */

export const TITRE_MAX = 120;
export const DESCRIPTION_MAX = 4000;

/** What the house refuses as a third party's data; the same names, the same order. */
export const CATEGORIES_TIERS = ["courriel", "telephone", "iban", "lien", "numero"] as const;
export type CategorieTiers = (typeof CATEGORIES_TIERS)[number];
export type CategorieTexte = "taille" | "controle" | CategorieTiers;

const MOTIFS: Record<CategorieTexte, string> = {
  taille: `titre de 1 à ${TITRE_MAX} caractères, description de 1 à ${DESCRIPTION_MAX}`,
  controle: "caractère de contrôle ou invisible (le titre tient sur une ligne)",
  courriel: "la demande contient une adresse de courriel",
  telephone: "la demande contient un numéro de téléphone",
  iban: "la demande contient un IBAN",
  lien: "la demande contient un lien ou un nom de domaine",
  numero: "la demande contient une suite de 9 chiffres ou plus",
};

/** A refusal, never a crash: the category, and a reason that never quotes the text. */
export class LiaisonTexteRefus extends Error {
  readonly categorie: CategorieTexte;
  constructor(categorie: CategorieTexte) {
    super(MOTIFS[categorie]);
    this.name = "LiaisonTexteRefus";
    this.categorie = categorie;
  }
}

// Python's \w and \b are Unicode-aware; these are their equivalents here.
const W = "[\\p{L}\\p{N}_]";
const NOT_W_BEFORE = `(?<!${W})`;
const NOT_W_AFTER = `(?!${W})`;

const COURRIEL = new RegExp(
  `[\\p{L}\\p{N}_.+-]\\s*(?:@|\\(\\s*at\\s*\\)|\\[\\s*at\\s*\\]|\\{\\s*at\\s*\\}|` +
    `${NOT_W_BEFORE}arobase${NOT_W_AFTER})\\s*[\\p{L}\\p{N}_-]`,
  "iu",
);
const TELEPHONES = [
  // +33 6 12 34 56 78, 0033612345678, +1 (555) 123-4567
  /(?<![\p{L}\p{N}_+])(?:\+|00)\s?\p{Nd}{1,3}(?:[\s.\-/]?\(?\p{Nd}{1,4}\)?){2,6}/u,
  // 06 12 34 56 78, 06.12.34.56.78, 0612345678
  /(?<!\p{Nd})0[1-9](?:[\s.-]?\p{Nd}{2}){4}(?!\p{Nd})/u,
];
const IBAN = new RegExp(`${NOT_W_BEFORE}[A-Z]{2}\\p{Nd}{2}(?:[ ]?[A-Z0-9]){11,30}`, "gu");
const TLD = "fr|com|net|org|io|eu|dev|app|co|be|ch|ca|lu|de|uk|info|biz|xyz|me|tv|ai|gouv";
const LIEN = new RegExp(
  `(?:${NOT_W_BEFORE}(?:https?|ftp|file|hxxps?)\\s*:\\s*/\\s*/|${NOT_W_BEFORE}www\\s*\\.|` +
    `${NOT_W_BEFORE}[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:${TLD})${NOT_W_AFTER})`,
  "iu",
);
const NUMERO = /\p{Nd}{9,}/u;
const DIGIT = /\p{Nd}/u;

/** Control, format, surrogate, private or unassigned — Python's category "C*". */
const CONTROLE = /\p{C}/u;
const CONTROLE_SAUF_LIGNES = /(?![\n\t])\p{C}/u;

const iban = (texte: string): boolean => {
  for (const m of texte.toUpperCase().matchAll(IBAN)) {
    if ([...m[0]].filter((c) => DIGIT.test(c)).length >= 10) return true;
  }
  return false;
};

/** The first category of a third party's data the text carries, or null. */
export function tiersDans(texte: string): CategorieTiers | null {
  // Compatibility form: full-width digits and at-signs, superscripts and other
  // disguises come back to their plain form before the examination.
  const t = texte.normalize("NFKC");
  if (COURRIEL.test(t)) return "courriel";
  if (TELEPHONES.some((r) => r.test(t))) return "telephone";
  if (iban(t)) return "iban";
  if (LIEN.test(t)) return "lien";
  if (NUMERO.test(t)) return "numero";
  return null;
}

export interface TexteDemande {
  readonly titre: string;
  readonly description: string;
}

/** Characters as the house and the table count them (code points). */
const longueur = (s: string): number => [...s].length;

/** The text as it is kept and sent — trimmed — or a LiaisonTexteRefus. */
export function validerTexteDemande(brut: TexteDemande): TexteDemande {
  if (typeof brut.titre !== "string" || typeof brut.description !== "string") {
    throw new LiaisonTexteRefus("taille");
  }
  const titre = brut.titre.trim();
  const description = brut.description.trim();
  if (titre === "" || description === "") throw new LiaisonTexteRefus("taille");
  if (longueur(titre) > TITRE_MAX || longueur(description) > DESCRIPTION_MAX) {
    throw new LiaisonTexteRefus("taille");
  }
  if (CONTROLE.test(titre) || CONTROLE_SAUF_LIGNES.test(description)) {
    throw new LiaisonTexteRefus("controle");
  }
  for (const texte of [titre, description]) {
    const categorie = tiersDans(texte);
    if (categorie !== null) throw new LiaisonTexteRefus(categorie);
  }
  return { titre, description };
}

/** A folder name, as the table holds it; whether it is declared is the configuration's. */
export const DOSSIER_RULE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
