// No person's name on a card (lot D, 13/11): the names an alert presents as a
// person — after a label such as « Contact : » — are removed by code from
// the card's title, company and place, whatever the model wrote. A job title
// is never mistaken for one. Fictional names only.
import { describe, expect, it } from "vitest";
import { offerWithoutNames, presentedNames, withoutNames } from "./people-names.ts";
import { runProspection } from "./run.ts";
import { source, world } from "./run-test-world.ts";

describe("the names an alert presents", () => {
  it.each([
    ["Contact : Marie-Anne Martin\nTJM 600", [["marie", "anne", "martin"]]],
    ["Votre recruteuse – Élodie Lefèvre", [["elodie", "lefevre"]]],
    ["CONTACT : Jean DUPONT", [["jean", "dupont"]]],
    ["Publiée par Paul Durand le 12/11", [["paul", "durand"]]],
    ["Talent Acquisition Partner: Nora Benali", [["nora", "benali"]]],
    ["Contact :\nJean Valjean\nTJM 600", [["jean", "valjean"]]],
    ["Interlocutrice : Ana", [["ana"]]],
  ])("%j", (text, names) => {
    expect(presentedNames(text)).toEqual(names);
  });

  it.each([
    "Consultante Java Senior H/F",
    "Recruteur de talents : postulez vite",
    "contact: support",
    "Contact : 06 12 34 56 78",
    "Référente technique sur le projet",
    "Mission à Lyon, contactez-nous",
  ])("no name in %j", (text) => {
    expect(presentedNames(text)).toEqual([]);
  });
});

describe("a card without them", () => {
  const names = [["jean", "valjean"]];

  it("removes each word of the name, accents and case aside, and nothing else", () => {
    expect(withoutNames("Mission Data — Jean Valjean", names)).toBe("Mission Data —");
    expect(withoutNames("JEAN-VALJEAN Conseil", names)).toBe("Conseil");
    expect(withoutNames("Jeanne Valjeantik SA", names)).toBe("Jeanne Valjeantik SA");
  });

  it("a company that was only the name becomes « not said »", () => {
    const offer = { title: "Ingénieur IA", company: "Jean Valjean", place: "Lyon" };
    expect(offerWithoutNames(offer, "Contact : Jean Valjean")).toEqual({
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
      '<p>Ingénieur IA, Lyon <a href="https://plateforme.example/m/1">voir</a></p><p>Contact : Jean Valjean</p>',
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
