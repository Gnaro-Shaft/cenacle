// The board's columns are decided on data (ADR-0032, points 10 to 14): an ESN
// of the list beats the model, doubt never passes, my profile is compared by
// code. And a settings file that cannot be read stops the agent: a profile
// read wrong would let every mission through.
import { describe, expect, it } from "vitest";
import { ProspectionConfigError, parseProspectionConfig } from "./config.ts";
import type { Offer } from "./extract.ts";
import { LOCAL, SHARED, testConfig } from "./test-config.ts";
import { duplicateKey, triage } from "./triage.ts";

const config = testConfig();
const offer = (over: Partial<Offer> = {}): Offer => ({
  title: "Ingénieur IA",
  company: "Banque Fictive",
  intermediary: "direct",
  stack: ["Python"],
  rate: [600, 700],
  remote: "total",
  place: "Paris",
  link: null,
  ...over,
});

describe("triage — the intermediary", () => {
  it("an ESN of the list stops the mission, even when the model says direct", () => {
    expect(triage(offer({ company: "GRANDE  esn" }), config, "mail")).toMatchObject({
      column: "detected",
      reason: "esn_list",
      decidedBy: "rule",
    });
    expect(triage(offer({ title: "Dev IA chez Conseil Fictif" }), config, "mail").reason).toBe(
      "esn_list",
    );
  });

  it("accents and case do not hide an ESN, but a longer word is not one", () => {
    const accented = parseProspectionConfig(
      SHARED.replace('"Grande ESN"', '"Société Générale de Conseil"'),
      LOCAL,
    );
    expect(triage(offer({ company: "societe generale de conseil" }), accented, "mail").reason).toBe(
      "esn_list",
    );
    expect(triage(offer({ company: "Lesnes Industries" }), config, "mail").column).toBe("alert");
  });

  it("a phrase that betrays an intermediary stops the mission", () => {
    expect(
      triage(offer({ title: "Data scientist pour le compte de notre client" }), config, "mail")
        .reason,
    ).toBe("esn_phrase");
  });

  it("the model's « esn » stops; its doubt does not pass", () => {
    expect(triage(offer({ intermediary: "esn" }), config, "mail")).toMatchObject({
      column: "detected",
      reason: "esn_model",
      decidedBy: "model",
    });
    expect(triage(offer({ intermediary: "inconnu" }), config, "mail").reason).toBe(
      "intermediary_unknown",
    );
  });

  it("a card I typed is never decided by the model", () => {
    expect(triage(offer({ intermediary: "inconnu" }), config, "me").decidedBy).toBe("me");
    expect(triage(offer(), config, "me").decidedBy).not.toBe("model");
  });
});

describe("triage — my profile", () => {
  it("a mission that fits reaches the alert", () => {
    expect(triage(offer(), config, "mail")).toEqual({
      column: "alert",
      reason: null,
      decidedBy: "rule",
      toCheck: false,
    });
  });

  it.each([
    ["no stack word of mine", { stack: ["Java", "Spring"] }, "stack"],
    ["an empty stack", { stack: [] }, "stack"],
    ["a maximum rate under mine", { rate: [400, 549] as const }, "rate"],
    ["no remote work, in a city not mine", { remote: "aucun" as const, place: "Brest" }, "remote"],
  ])("%s stops at « Client direct »", (_label, over, reason) => {
    expect(triage(offer(over), config, "mail")).toMatchObject({ column: "direct", reason });
  });

  it("a stack word is matched as a word: « Python 3 » is Python, « Pythonic » is not", () => {
    expect(triage(offer({ stack: ["Python 3"] }), config, "mail").column).toBe("alert");
    expect(triage(offer({ stack: ["Pythonic"] }), config, "mail").reason).toBe("stack");
  });

  it("no remote work, but in a city of mine: it passes", () => {
    expect(triage(offer({ remote: "aucun", place: "Lyon (69)" }), config, "mail").column).toBe(
      "alert",
    );
  });

  it("an unsaid rate or remote work never refuses: it passes, to check", () => {
    for (const over of [{ rate: null }, { remote: "inconnu" as const }]) {
      expect(triage(offer(over), config, "mail")).toMatchObject({ column: "alert", toCheck: true });
    }
  });
});

describe("duplicates", () => {
  it("the same mission, written differently, is the same", () => {
    expect(duplicateKey(offer({ title: "INGÉNIEUR  IA" }), "P")).toBe(duplicateKey(offer(), "P"));
  });

  it("another platform, place or company is another mission", () => {
    const key = duplicateKey(offer(), "P");
    expect(duplicateKey(offer(), "Q")).not.toBe(key);
    expect(duplicateKey(offer({ place: "Lyon" }), "P")).not.toBe(key);
    expect(duplicateKey(offer({ company: "Autre" }), "P")).not.toBe(key);
  });

  it("without a company, never a duplicate: better twice than lost", () => {
    expect(duplicateKey(offer({ company: null }), "P")).toBeNull();
  });
});

describe("settings — refused files", () => {
  it.each([
    ["an unknown key", LOCAL.replace("[profil]", "[profil]\nbudget = 3")],
    ["no profile", LOCAL.replace(/\[profil\][\s\S]*$/, "")],
    ["an empty stack", LOCAL.replace('stack = ["python", "llm"]', "stack = []")],
    ["a rate as text", LOCAL.replace("tjm_min = 550", 'tjm_min = "550"')],
    ["remote work « inconnu » accepted", LOCAL.replace('"partiel"]', '"inconnu"]')],
    ["no platform", LOCAL.replace(/\[\[plateforme\]\][\s\S]*?\[profil\]/, "[profil]")],
    ["a wildcard host", LOCAL.replace('"clic.plateforme.example"', '"*.plateforme.example"')],
    [
      "a host with a path",
      LOCAL.replace('"clic.plateforme.example"', '"clic.plateforme.example/x"'),
    ],
    [
      "an uppercase domain",
      LOCAL.replace('domaine = "plateforme.example"', 'domaine = "Plateforme.example"'),
    ],
    [
      "the same platform twice",
      `${LOCAL}\n[[plateforme]]\nnom = "B"\ndomaine = "plateforme.example"\nhotes_liens = ["plateforme.example"]`,
    ],
    ["invalid TOML", "[profil"],
  ])("refuses %s", (_label, local) => {
    expect(() => parseProspectionConfig(SHARED, local)).toThrow(ProspectionConfigError);
  });

  it.each([
    ["an unknown section", `${SHARED}\n[autre]\nx = 1`],
    ["a cap of zero", SHARED.replace("annonces_max = 5", "annonces_max = 0")],
    ["no phrase", SHARED.replace(/tournures = \[.*\]/, "tournures = []")],
  ])("refuses a shared file with %s", (_label, shared) => {
    expect(() => parseProspectionConfig(shared, LOCAL)).toThrow(ProspectionConfigError);
  });
});

describe("a platform I declared direct (revision of 2026-10-22)", () => {
  const declared = { directByDefault: true };

  it("the model's doubt passes, flagged to check", () => {
    expect(triage(offer({ intermediary: "inconnu" }), config, "mail", declared)).toMatchObject({
      column: "alert",
      toCheck: true,
    });
  });

  it("never against the model's own « esn », the ESN list or a phrase", () => {
    expect(triage(offer({ intermediary: "esn" }), config, "mail", declared).reason).toBe(
      "esn_model",
    );
    expect(
      triage(offer({ intermediary: "inconnu", company: "Grande ESN" }), config, "mail", declared)
        .reason,
    ).toBe("esn_list");
    expect(
      triage(
        offer({ intermediary: "inconnu", title: "Dev pour le compte de notre client" }),
        config,
        "mail",
        declared,
      ).reason,
    ).toBe("esn_phrase");
  });

  it("an undeclared platform keeps doubt out; a card I typed is never touched by it", () => {
    expect(triage(offer({ intermediary: "inconnu" }), config, "mail").reason).toBe(
      "intermediary_unknown",
    );
    expect(
      triage(offer({ intermediary: "inconnu" }), config, "mail", { directByDefault: false }).reason,
    ).toBe("intermediary_unknown");
    expect(triage(offer({ intermediary: "inconnu" }), config, "me", declared).reason).toBe(
      "intermediary_unknown",
    );
  });

  it("the profile still applies: a direct mission off my profile stops", () => {
    expect(
      triage(offer({ intermediary: "inconnu", stack: ["Java"] }), config, "mail", declared),
    ).toMatchObject({ column: "direct", reason: "stack" });
  });

  it("the settings accept only « direct », never another value", () => {
    const local = (value: string) =>
      LOCAL.replace(
        'hotes_liens = ["plateforme.example", "clic.plateforme.example"]',
        `hotes_liens = ["plateforme.example"]\nintermediaire_par_defaut = ${value}`,
      );
    expect(parseProspectionConfig(SHARED, local('"direct"')).platforms[0]?.directByDefault).toBe(
      true,
    );
    expect(parseProspectionConfig(SHARED, LOCAL).platforms[0]?.directByDefault).toBe(false);
    for (const bad of ['"esn"', '"inconnu"', "true", '"Direct"']) {
      expect(() => parseProspectionConfig(SHARED, local(bad))).toThrow(ProspectionConfigError);
    }
  });
});
