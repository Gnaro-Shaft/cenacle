// The text of a demand to the house (ADR-0048): every category the house
// refuses is refused here first, disguised or not, and a refusal never quotes
// the value it found. Ordinary work — versions, file names, dates, ticket
// numbers — passes: a filter that refuses everything would be bypassed.
import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_MAX,
  LiaisonTexteRefus,
  TITRE_MAX,
  tiersDans,
  validerTexteDemande,
} from "./liaison-filtre.ts";

const refus = (titre: string, description = "Une description ordinaire.") => {
  try {
    validerTexteDemande({ titre, description });
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(LiaisonTexteRefus);
    return e as LiaisonTexteRefus;
  }
};

describe("a third party's data, disguised, is refused by its category", () => {
  const cas: [string, string][] = [
    ["écrire à jean.dupont@exemple.org", "courriel"],
    ["JEAN [AT] EXEMPLE", "courriel"],
    ["jean ( at ) exemple", "courriel"],
    ["jean {at} exemple", "courriel"],
    ["jean arobase exemple", "courriel"],
    ["jean＠exemple", "courriel"],
    ["appeler le +33 6 12 34 56 78", "telephone"],
    ["0033612345678", "telephone"],
    ["06 12 34 56 78", "telephone"],
    ["06.12.34.56.78", "telephone"],
    ["06-12-34-56-78", "telephone"],
    ["０６１２３４５６７８", "telephone"],
    ["+1 (555) 123-4567", "telephone"],
    ["virement FR76 3000 6000 0112 3456 7890 189", "iban"],
    ["fr7630006000011234567890189", "iban"],
    ["voir https://exemple.org/x", "lien"],
    ["HTTP : // exemple", "lien"],
    ["hxxps://piège", "lien"],
    ["www . exemple", "lien"],
    ["le site exemple.fr", "lien"],
    ["sous.domaine.exemple.COM", "lien"],
    ["mon-service.gouv", "lien"],
    ["commande 123456789", "numero"],
    ["dossier ₁₂₃₄₅₆₇₈₉", "numero"],
  ];
  for (const [texte, categorie] of cas) {
    it(`${categorie} : « ${texte} »`, () => {
      expect(tiersDans(texte)).toBe(categorie);
      // In the title or in the description, the same.
      expect(refus(texte)?.categorie).toBe(categorie);
      expect(refus("Un titre", `Ligne une.\n${texte}\nLigne trois.`)?.categorie).toBe(categorie);
    });
  }

  it("the refusal names the category, never the value", () => {
    const e = refus("Un titre", "joindre jean.dupont@exemple.org ou le 0612345678");
    expect(e?.categorie).toBe("courriel");
    expect(e?.message).not.toMatch(/jean|dupont|exemple|0612/);
    expect(JSON.stringify(e)).not.toMatch(/jean|dupont|exemple|0612/);
  });
});

describe("ordinary work passes", () => {
  const ordinaires = [
    "Refaire la page d'accueil du projet",
    "Mettre à jour imapflow-2.12.1 et Node 22.19",
    "version 1.2.3, puis config.toml et README.md",
    "Le ticket GNA-22 et la tâche T-12",
    "Le 2026-11-25, prix 12 345 678 €",
    "12345678 tests",
    "@pseudo sur le forum, et test@",
    "café.co n'est pas un domaine connu de ce filtre",
    "Écrire l'ADR, accents compris : à é è ç ô ü",
  ];
  for (const texte of ordinaires) {
    it(`« ${texte} »`, () => {
      expect(tiersDans(texte)).toBeNull();
      expect(refus(texte)).toBeNull();
    });
  }
});

describe("sizes and control characters", () => {
  it("trimmed as kept; empty, or only spaces, refused", () => {
    expect(validerTexteDemande({ titre: "  t  ", description: "\n d \n" })).toEqual({
      titre: "t",
      description: "d",
    });
    expect(refus("   ")?.categorie).toBe("taille");
    expect(refus("t", "  \n\t ")?.categorie).toBe("taille");
  });

  it("counted in characters as the table counts them, emoji included", () => {
    expect(refus("é".repeat(TITRE_MAX))).toBeNull();
    expect(refus("é".repeat(TITRE_MAX + 1))?.categorie).toBe("taille");
    expect(refus("🏠".repeat(TITRE_MAX))).toBeNull();
    expect(refus("t", "d".repeat(DESCRIPTION_MAX))).toBeNull();
    expect(refus("t", "d".repeat(DESCRIPTION_MAX + 1))?.categorie).toBe("taille");
  });

  it("the title holds on one line; the description allows line breaks and tabs only", () => {
    expect(refus("deux\nlignes")?.categorie).toBe("controle");
    expect(refus("tab\tulé")?.categorie).toBe("controle");
    expect(refus("t", "a\nb\tc")).toBeNull();
    for (const c of ["\r", "\u0000", "\u001b[31m", "\u007f", "\u0085"]) {
      expect(refus("t", `a${c}b`)?.categorie).toBe("controle");
    }
  });

  it("invisible and direction characters are refused: what I read is what leaves", () => {
    for (const c of ["​", "‎", "‮", "⁦", "﻿", "­"]) {
      expect(refus(`titre${c}piégé`)?.categorie).toBe("controle");
      expect(refus("t", `d${c}d`)?.categorie).toBe("controle");
    }
  });

  it("a lone surrogate or a private-use character is refused", () => {
    expect(refus("t", "a\ud800b")?.categorie).toBe("controle");
    expect(refus("t")?.categorie).toBe("controle");
  });

  it("anything but text is refused, never a crash", () => {
    expect(refus(42 as unknown as string)?.categorie).toBe("taille");
    expect(() =>
      validerTexteDemande({ titre: "t", description: null as unknown as string }),
    ).toThrow(LiaisonTexteRefus);
  });
});
