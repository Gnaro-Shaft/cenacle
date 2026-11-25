// The « Maison » tab's rules (ADR-0048): a link is shown only if it is a pull
// request on GitHub, of the exact form — whatever the house's model wrote; a
// status the page does not know is shown as it came, never taken for another;
// an old reading is never said fresh; the cancel delay counts down to 0.
import { describe, expect, it } from "vitest";
import type { DemandeView } from "./liaison-api.ts";
import {
  echecLabel,
  formBlocker,
  lectureLabel,
  lienSur,
  maisonLabel,
  secondesPourAnnuler,
} from "./maison-rules.ts";

describe("links", () => {
  const cas: [string, boolean][] = [
    ["https://github.com/proprietaire/depot/pull/10", true],
    ["http://github.com/proprietaire/depot/pull/10", false],
    ["https://github.com.evil.example/p/d/pull/1", false],
    ["javascript:alert(1)//https://github.com/p/d/pull/1", false],
    ["https://github.com/p/d/pull/1?x=https://evil", false],
    ["https://github.com/p/d/pull/1#frag", false],
    ["https://github.com/p/d/issues/1", false],
    [" https://github.com/p/d/pull/1", false],
  ];
  for (const [url, ok] of cas) {
    it(`${url}: ${ok}`, () => {
      expect(lienSur(url)).toBe(ok);
    });
  }
});

describe("labels", () => {
  it("a known status in French; an unknown one as it came, never another", () => {
    expect(maisonLabel("in_review")).toBe("en relecture");
    expect(maisonLabel("constructor")).toBe("constructor");
    expect(maisonLabel("__proto__")).toBe("__proto__");
    expect(maisonLabel("inconnu")).toBe("inconnu");
  });

  it("a cut line says the demand may have left, never that nothing did", () => {
    expect(echecLabel("transport")).toMatch(/peut-être été déposée/);
    expect(echecLabel("ssh")).toMatch(/rien n'est parti/);
    expect(echecLabel("courriel")).toBe("refusée (courriel)");
  });
});

describe("time", () => {
  const d = (over: Partial<DemandeView>): DemandeView => ({
    id: 1,
    statut: "acceptee",
    origine: "directe",
    titre: "t",
    description: "d",
    dossier: "x",
    creeLe: "2026-11-25T12:00:00Z",
    partirApres: "2026-11-25T12:02:00Z",
    ticket: null,
    categorie: null,
    maison: null,
    ...over,
  });
  const at = (iso: string) => Date.parse(iso);

  it("the delay counts down, then 0; never for a demand not accepted", () => {
    expect(secondesPourAnnuler(d({}), at("2026-11-25T12:00:00Z"))).toBe(120);
    expect(secondesPourAnnuler(d({}), at("2026-11-25T12:03:00Z"))).toBe(0);
    expect(secondesPourAnnuler(d({ statut: "attente" }), at("2026-11-25T12:00:00Z"))).toBe(0);
  });

  it("a reading: its age, and a failed one said as failed", () => {
    const now = at("2026-11-25T12:30:00Z");
    expect(lectureLabel(null, now)).toBe("état de la maison jamais lu");
    expect(lectureLabel({ le: "2026-11-25T12:00:00Z", issue: "lu" }, now)).toBe(
      "état lu il y a 30 min",
    );
    expect(lectureLabel({ le: "2026-11-25T12:29:30Z", issue: "lu" }, now)).toBe(
      "état lu à l'instant",
    );
    expect(lectureLabel({ le: "2026-11-25T12:00:00Z", issue: "echec" }, now)).toMatch(/échec/);
  });
});

describe("the form", () => {
  it("what is missing, before anything is sent", () => {
    expect(formBlocker({ titre: " ", description: "d", dossier: "x" })).toBe("un titre");
    expect(formBlocker({ titre: "a\nb", description: "d", dossier: "x" })).toBe(
      "un titre sur une ligne",
    );
    expect(formBlocker({ titre: "t", description: "", dossier: "x" })).toBe("une description");
    expect(formBlocker({ titre: "t", description: "d", dossier: "" })).toBe("un dossier");
    expect(formBlocker({ titre: "é".repeat(121), description: "d", dossier: "x" })).toMatch(/120/);
    expect(formBlocker({ titre: "t", description: "d", dossier: "x" })).toBeNull();
  });
});
