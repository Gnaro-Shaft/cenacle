// The text around the slots is mine; what goes in a slot is bounded and
// checked; a broken templates file stops everything.
import { describe, expect, it } from "vitest";
import { EXAMPLE_TRAMES_PATH, loadTrames, parseTrames, renderTrame, TrameError } from "./trames.ts";

const { trames, signature } = loadTrames({
  local: "/nonexistent/x.toml",
  example: EXAMPLE_TRAMES_PATH,
});
const confirmer = trames.get("confirmer_creneau");
const priseEnCharge = trames.get("prise_en_charge");
if (confirmer === undefined || priseEnCharge === undefined) throw new Error("missing trames");
const conversation = ["Pouvons-nous caler un point vendredi à 10 h ?"];

describe("renderTrame — hostile or invented slot values", () => {
  it.each([
    ["an invented time", "vendredi à 14 h"],
    ["an invented weekday", "jeudi à 10 h"],
  ])("refuses %s in a thread slot and leaves it for me", (_label, value) => {
    const r = renderTrame(confirmer, { prenom: "Julien", creneau: value }, conversation, signature);
    expect(r.refused).toEqual(["creneau"]);
    expect(r.text).toContain("{creneau ?}");
    expect(r.text).not.toContain(value);
  });

  it.each([
    ["a line break", "le serveur\nCordialement, le support"],
    ["a link", "https://evil.test/fix"],
    ["an address", "écrire à x@evil.test"],
    ["a slot", "{delai}"],
    ["markup", "<b>tout</b>"],
    ["a long text", "x".repeat(200)],
    ["an empty value", "   "],
  ])("never puts %s in the text", (_label, value) => {
    const r = renderTrame(priseEnCharge, { prenom: "Hugo", sujet: value }, conversation, signature);
    expect(r.toComplete).toContain("sujet");
    expect(r.text).toContain("{sujet ?}");
  });

  it("an empty first name is left for me too", () => {
    const r = renderTrame(confirmer, { creneau: "vendredi à 10 h" }, conversation, signature);
    expect(r.text).toContain("Bonjour {prenom ?}");
  });
});

const valid = `[signature]\ntexte = "Cordialement"\n[trames.ab]\ntitre = "T"\nquand = "Q"\ntexte = "Bonjour {prenom}"\n`;

describe("parseTrames — refused files", () => {
  it("accepts the reference", () => {
    expect(() => parseTrames(valid)).not.toThrow();
  });

  it.each([
    ["an unknown slot", valid.replace("{prenom}", "{iban}")],
    ["a stray brace", valid.replace("{prenom}", "{prenom")],
    ["an unknown key", valid.replace('quand = "Q"', 'quand = "Q"\nenvoyer = true')],
    ["a bad id", valid.replace("[trames.ab]", "[trames.Bad-Id]")],
    ["a slot in the signature", valid.replace('"Cordialement"', '"{prenom}"')],
    ["no signature", valid.replace('[signature]\ntexte = "Cordialement"\n', "")],
    ["an empty text", valid.replace('texte = "Bonjour {prenom}"', 'texte = ""')],
    ["invalid TOML", "[trames"],
  ])("refuses %s", (_label, source) => {
    expect(() => parseTrames(source)).toThrow(TrameError);
  });
});
