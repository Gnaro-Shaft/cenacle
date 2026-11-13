// No person's name on a card (lot D, 13/11): the names an alert presents as a
// person — after a label such as « Recruteuse : » — are removed by code from
// the card's title, company and place, whatever the model wrote. Careful: a
// job title, a company after « Contact : », a first name inside a company's
// name are never touched. Fictional names only.
import { describe, expect, it } from "vitest";
import { offerWithoutNames, presentedNames, withoutNames } from "./people-names.ts";
import { runProspection } from "./run.ts";
import { source, world } from "./run-test-world.ts";

describe("the names an alert presents", () => {
  it.each([
    ["Recruteuse : Marie-Anne Martin\nTJM 600", [["marie", "anne", "martin"]]],
    ["RECRUTEUR : Jean DUPONT", [["jean", "dupont"]]],
    ["Publiée par Paul Durand le 12/11", [["paul", "durand"]]],
    ["Talent Acquisition Partner: Nora Benali", [["nora", "benali"]]],
    ["Chargée de recrutement : Élodie Lefèvre", [["elodie", "lefevre"]]],
  ])("%j", (text, names) => {
    expect(presentedNames(text)).toEqual(names);
  });

  // Careful by design (D2 review): a card damaged in silence is worse than a name missed.
  it.each([
    ["a job title after a hyphen", "Consultant - Développeur Java Senior"],
    ["a company after « Contact : »", "Contact : Banque Fictive RH"],
    ["« Contact : » at all (a name missed, said in the notice)", "Contact : Jean Dupont"],
    ["a label inside a word", "Recontact: Marc Dupont"],
    ["the next line's heading", "Recruteur :\nTarif 500"],
    ["one word only", "Interlocutrice : Ana"],
    ["lower case", "recruteur : support technique"],
    ["a role word as a title", "Consultante Java Senior H/F"],
    ["a phone number", "Recruteur : 06 12 34 56 78"],
  ])("no name for %s", (_label, text) => {
    expect(presentedNames(text)).toEqual([]);
  });
});

describe("a card without them", () => {
  const names = [["jean", "valjean"]];

  it("removes the whole name, accents and case aside, and nothing else", () => {
    expect(withoutNames("Mission Data — Jean Valjean", names)).toBe("Mission Data —");
    expect(withoutNames("JEAN-VALJEAN Conseil", names)).toBe("Conseil");
    expect(withoutNames("Jeanne Valjeantik SA", names)).toBe("Jeanne Valjeantik SA");
  });

  it("never one of its words elsewhere: a first name stays in a company's name", () => {
    expect(withoutNames("Pierre & Vacances", [["pierre", "martin"]])).toBe("Pierre & Vacances");
    expect(withoutNames("Valjean Industries pour Jean", names)).toBe(
      "Valjean Industries pour Jean",
    );
  });

  it("a company that was only the name becomes « not said »", () => {
    const offer = { title: "Ingénieur IA", company: "Jean Valjean", place: "Lyon" };
    expect(offerWithoutNames(offer, "Recruteur : Jean Valjean")).toEqual({
      title: "Ingénieur IA",
      company: null,
      place: "Lyon",
    });
  });

  it("an offer whose title was only the name is dropped", () => {
    const offer = { title: "Jean Valjean", company: null, place: null };
    expect(offerWithoutNames(offer, "Recruteur : Jean Valjean")).toBeNull();
  });

  it("an alert that presents nobody leaves the offer as it was", () => {
    const offer = { title: "Consultante Java Senior", company: "Banque Fictive", place: null };
    expect(offerWithoutNames(offer, "Consultante Java Senior, Banque Fictive")).toBe(offer);
  });
});

describe("a pass: what the model wrote, the code still cleans", () => {
  it("the model puts the recruiter as the company: the card says « not said »", async () => {
    const alert = source(
      "alertes@plateforme.example",
      '<p>Ingénieur IA, Lyon <a href="https://plateforme.example/m/1">voir</a></p><p>Recruteur : Jean Valjean</p>',
    );
    const answer = JSON.stringify([
      {
        intitule: "Ingénieur IA pour Jean Valjean",
        entreprise: "Jean Valjean",
        intermediaire: "direct",
        stack: ["Python"],
        tjm: [600, 700],
        teletravail: "total",
        lieu: "Lyon",
        lien: "https://plateforme.example/m/1",
      },
    ]);
    const w = world([{ id: 1, source: alert }], { ask: async () => answer });
    await runProspection(w.deps);
    const card = w.recorded[0]?.cards[0];
    expect(card).toMatchObject({ title: "Ingénieur IA pour", company: null, place: "Lyon" });
    expect(JSON.stringify(w.recorded)).not.toMatch(/valjean/i);
  });
});
