// The liaison's retentions (ADR-0048, T-12): both or neither — a text wiped
// without its row's end, or the reverse, is a gap — the row kept at least as
// long as its text, and each a whole number of days.
import { describe, expect, it } from "vitest";
import { parseConservation } from "./traitements.ts";

const BASE = {
  memoire_jours: 90,
  texte_brouillon_jours: 7,
  propositions_jours: 90,
  journal_jours: 180,
  opposition_jours: 1095,
};

describe("liaison_texte_jours and liaison_jours", () => {
  it("absent, both: no retention, so the liaison does not run", () => {
    const c = parseConservation(BASE);
    expect(c.liaisonTexteJours).toBeUndefined();
    expect(c.liaisonJours).toBeUndefined();
  });

  it("said, both: read", () => {
    const c = parseConservation({ ...BASE, liaison_texte_jours: 30, liaison_jours: 90 });
    expect([c.liaisonTexteJours, c.liaisonJours]).toEqual([30, 90]);
  });

  it("one without the other: refused", () => {
    expect(() => parseConservation({ ...BASE, liaison_texte_jours: 30 })).toThrow(/go together/);
    expect(() => parseConservation({ ...BASE, liaison_jours: 90 })).toThrow(/go together/);
  });

  it("the row kept less long than its text: refused", () => {
    expect(() =>
      parseConservation({ ...BASE, liaison_texte_jours: 30, liaison_jours: 29 }),
    ).toThrow(/at least liaison_texte_jours/);
  });

  it.each([0, -1, 91, 1.5, "30", true])("liaison_texte_jours = %s: refused", (value) => {
    expect(() =>
      parseConservation({ ...BASE, liaison_texte_jours: value, liaison_jours: 90 }),
    ).toThrow(/liaison_texte_jours must be a number of days from 1 to 90/);
  });

  it.each([0, 366, 2.5, "90"])("liaison_jours = %s: refused", (value) => {
    expect(() =>
      parseConservation({ ...BASE, liaison_texte_jours: 1, liaison_jours: value }),
    ).toThrow(/liaison_jours must be a number of days from 1 to 365/);
  });
});
