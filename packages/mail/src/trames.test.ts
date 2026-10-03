import { describe, expect, it } from "vitest";
import { EXAMPLE_TRAMES_PATH, firstName, loadTrames, renderTrame } from "./trames.ts";

const { trames, signature } = loadTrames({
  local: "/nonexistent/x.toml",
  example: EXAMPLE_TRAMES_PATH,
});
const conversation = [
  "Point d'avancement vendredi ?",
  "Pouvons-nous caler un point d'avancement vendredi à 10 h ?",
];

describe("trames", () => {
  it("the example file is valid: six templates and a signature", () => {
    expect([...trames.keys()]).toEqual([
      "accuse_reception",
      "confirmer_creneau",
      "proposer_creneau",
      "demander_precision",
      "prise_en_charge",
      "decliner",
    ]);
    expect(signature).toContain("Bien cordialement");
  });

  it("fills code and thread slots, and capitalizes a value that starts a sentence", () => {
    const trame = trames.get("confirmer_creneau");
    if (trame === undefined) throw new Error("missing");
    const r = renderTrame(
      trame,
      { prenom: "Julien", creneau: "vendredi à 10 h" },
      conversation,
      signature,
    );
    expect(r.text.startsWith("Bonjour Julien,\n\nVendredi à 10 h me convient très bien.")).toBe(
      true,
    );
    expect(r.text.endsWith(signature)).toBe(true);
    expect(r.toComplete).toEqual([]);
  });

  it("always leaves owner slots for me, visible", () => {
    const trame = trames.get("accuse_reception");
    if (trame === undefined) throw new Error("missing");
    const r = renderTrame(
      trame,
      { prenom: "Claire", objet: "Prolongation", delai: "demain" },
      conversation,
      signature,
    );
    expect(r.text).toContain("je reviens vers vous {delai ?}.");
    expect(r.toComplete).toEqual(["delai"]);
  });

  it.each([
    ["Julien Perrin", "Julien"],
    ["Inès Haddad", "Inès"],
    ["Atelier Lumen — Support", "Atelier"],
    ["support", null],
    ["", null],
  ])("firstName(%j) = %j", (name, first) => {
    expect(firstName(name)).toBe(first);
  });
});
