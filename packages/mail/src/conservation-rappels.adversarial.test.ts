// The reminders' retention (ADR-0041): optional in the cadre — absent, the bot
// keeps no reminder — and, when said, a whole number of days from 1 to 365.
import { describe, expect, it } from "vitest";
import { parseConservation } from "./traitements.ts";

const BASE = {
  memoire_jours: 90,
  texte_brouillon_jours: 7,
  propositions_jours: 90,
  journal_jours: 180,
  opposition_jours: 1095,
};

describe("rappels_jours", () => {
  it("absent: no retention, so no reminder can be kept", () => {
    expect(parseConservation(BASE).rappelsJours).toBeUndefined();
  });

  it("said: read", () => {
    expect(parseConservation({ ...BASE, rappels_jours: 90 }).rappelsJours).toBe(90);
  });

  it.each([0, -1, 366, 1.5, "90", true])("%s: refused", (value) => {
    expect(() => parseConservation({ ...BASE, rappels_jours: value })).toThrow(
      /rappels_jours must be a number of days from 1 to 365/,
    );
  });
});
