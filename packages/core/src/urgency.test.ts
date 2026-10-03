import { describe, expect, it } from "vitest";
import { loadFixtureMailbox } from "./fixtures.ts";
import { hasUrgentTerm } from "./urgency.ts";

describe("hasUrgentTerm", () => {
  it.each([
    "URGENT : la démo ne démarre plus",
    "Urgent — contrat",
    "urgent: réunion",
    "URGENCE — données",
    "ASAP : validation",
    "Besoin d'une réponse au plus vite",
    "Dès que possible : identifiants",
    "des que POSSIBLE",
  ])("finds %j", (subject) => {
    expect(hasUrgentTerm(subject)).toBe(true);
  });

  it.each(["Urgentiste de garde", "Point d'avancement", "", "Plus vite que prévu", "ASAPs"])(
    "ignores %j",
    (subject) => {
      expect(hasUrgentTerm(subject)).toBe(false);
    },
  );

  it("with the category, it gives exactly the fixtures' urgent mails", () => {
    for (const m of loadFixtureMailbox().messages) {
      const alert = m.expected.category === "clients_prospects" && hasUrgentTerm(m.subject);
      expect(alert, m.id).toBe(m.expected.urgent);
    }
  });
});
