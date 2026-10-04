// The article 9 floor (C2): case, accents, separators and spacing must not let
// a special category through; the words left out on purpose must not set
// ordinary mails aside; and the floor never says more than "set aside or not".
import { describe, expect, it } from "vitest";
import {
  assertNotSensitive,
  revealsSpecialCategory,
  SensitiveMailError,
  sensitiveCategory,
} from "./sensitive.ts";

const mail = (subject: string, text = "Bonjour,\n\nÀ bientôt.") => ({ subject, text });

describe("the floor catches what tries to slip through", () => {
  it.each([
    ["an accent", "Je suis à l'hôpital", "sante"],
    ["capitals", "RENDEZ-VOUS À L'HÔPITAL", "sante"],
    ["no accent", "un arret maladie", "sante"],
    ["underscores", "dossier_sante_2026", "sante"],
    ["a root", "mon nouveau médicament", "sante"],
    ["a hyphenated word", "suite à mon burn-out", "sante"],
    ["spaced letters", "mon s a n t é va mieux", "sante"],
    ["dotted letters", "la visite M.É.D.I.C.A.L.E de mardi", "sante"],
    ["starred letters", "s*y*n*d*i*c*a*t", "opinions"],
    ["a union", "réunion du syndicat", "opinions"],
    ["a strike", "avec la grève de jeudi", "opinions"],
    ["a belief", "jour de prière", "convictions"],
    ["an origin", "ma demande d'asile", "origine"],
    ["a conviction", "un extrait de casier judiciaire", "condamnations"],
    ["a conviction root", "après sa condamnation", "condamnations"],
    ["genetics", "mes résultats d'ADN", "genetique-biometrie"],
    ["sex life", "l'association LGBT", "vie-sexuelle"],
  ])("%s", (_label, text, category) => {
    expect(sensitiveCategory(text)).toBe(category);
  });

  it("a sensitive word in the subject alone is enough", () => {
    expect(revealsSpecialCategory(mail("Mon état de santé"))).toBe(true);
  });

  it("a sensitive word in the text alone is enough", () => {
    expect(revealsSpecialCategory(mail("Point", "Je serai en arrêt maladie demain."))).toBe(true);
  });
});

describe("the floor does not set ordinary mails aside for nothing", () => {
  it.each([
    ["the agent's own name", "Iris vous a préparé un brouillon"],
    ["a verb, not a party", "je suis parti tôt ce matin"],
    ["a privacy policy", "consultez notre politique de confidentialité"],
    ["a vote of a newsletter", "votez pour votre outil préféré"],
    ["a word containing a short term", "rendez-vous à Marseille, vihara"],
    ["a client project", "Mission RAG : indexer 3 000 documents"],
    ["ordinary words", "voici le devis signé et la facture"],
    ["a letter run borrowing a word", "à la mi-temps du match"],
  ])("%s", (_label, text) => {
    expect(sensitiveCategory(text)).toBeNull();
  });
});

describe("the model's own entry points refuse", () => {
  it("throws on a sensitive mail, says nothing of why", () => {
    expect(() => assertNotSensitive(mail("Arrêt maladie"))).toThrow(SensitiveMailError);
    try {
      assertNotSensitive(mail("Arrêt maladie"));
    } catch (error) {
      expect(String(error)).not.toMatch(/sant|maladie|health/i);
    }
  });

  it("lets an ordinary mail through", () => {
    expect(() => assertNotSensitive(mail("Point d'avancement"))).not.toThrow();
  });
});
