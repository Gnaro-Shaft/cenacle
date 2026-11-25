// Drafting from a mail is closed unless both keys are written (ADR-0049): a
// folder path, and the day the notice was republished, as a TOML date; one
// without the other, or a malformed one, is refused — never taken for open.
import { describe, expect, it } from "vitest";
import { LiaisonConfigError, parseLiaisonPorte, parseLiaisonRedaction } from "./liaison-config.ts";

const base = `[liaison]
hote = "vm-maison"
compte = "liaison"
cle = "/Users/moi/.ssh/cle"
known_hosts = "/Users/moi/.ssh/kh"
dossiers = ["maison-etalon"]
`;
const kind = (text: string) => {
  try {
    parseLiaisonRedaction(text);
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(LiaisonConfigError);
    return (e as LiaisonConfigError).problem;
  }
};

describe("the opening of drafting", () => {
  it("neither key: closed (null), and the door still reads", () => {
    expect(parseLiaisonRedaction(base)).toBeNull();
    expect(parseLiaisonPorte(base).hote).toBe("vm-maison");
  });

  it("both: the folder, and midnight of that day", () => {
    const c = parseLiaisonRedaction(
      `${base}dossier_travail = "Travail"\nredaction_ouverte = 2026-12-01\n`,
    );
    expect(c?.dossierTravail).toBe("Travail");
    expect(c?.ouverte.getFullYear()).toBe(2026);
    expect(c?.ouverte.getMonth()).toBe(11);
    expect(c?.ouverte.getDate()).toBe(1);
    expect(c?.ouverte.getHours()).toBe(0);
  });

  it.each([
    ["the folder alone", 'dossier_travail = "Travail"\n'],
    ["the date alone", "redaction_ouverte = 2026-12-01\n"],
    ["a date as text", 'dossier_travail = "Travail"\nredaction_ouverte = "2026-12-01"\n'],
    ["an empty folder", 'dossier_travail = ""\nredaction_ouverte = 2026-12-01\n'],
    [
      "a folder with a line break",
      'dossier_travail = "Tra\\nvail"\nredaction_ouverte = 2026-12-01\n',
    ],
    [
      "a folder with spaces around",
      'dossier_travail = " Travail"\nredaction_ouverte = 2026-12-01\n',
    ],
  ])("%s: refused, never open", (_what, extra) => {
    expect(kind(`${base}${extra}`)).toBe("redaction");
  });
});
