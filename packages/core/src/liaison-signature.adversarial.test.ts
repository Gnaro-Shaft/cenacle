// My acceptance of a demand, signed by the page (ADR-0048): a signature binds
// this demand, this folder, this exact text and this instant — copied onto
// another demand, kept after an edit, or taken from a draft's acceptance, it
// is refused. Verification never throws.
import { describe, expect, it } from "vitest";
import {
  generateAcceptanceKeys,
  privateKeyFromEnv,
  publicKeyFromEnv,
  signAcceptance,
} from "./acceptance.ts";
import {
  type LiaisonAcceptation,
  signerLiaison,
  texteHash,
  verifierLiaison,
} from "./liaison-signature.ts";

const keys = generateAcceptanceKeys();
const env = {
  CENACLE_ACCEPT_PRIVATE_KEY: keys.privateKey,
  CENACLE_ACCEPT_PUBLIC_KEY: keys.publicKey,
};
const priv = privateKeyFromEnv(env);
const pub = publicKeyFromEnv(env);
const other = generateAcceptanceKeys();
const otherPriv = privateKeyFromEnv({ CENACLE_ACCEPT_PRIVATE_KEY: other.privateKey });

const base: LiaisonAcceptation = {
  id: 7,
  origine: "directe",
  dossier: "maison-etalon",
  titre: "Refaire la page",
  description: "Avec des tests.",
  decideLe: new Date("2026-11-25T10:00:00.000Z"),
};
const sig = signerLiaison(priv, base);

describe("a signature binds what I accepted", () => {
  it("valid for this demand", () => {
    expect(verifierLiaison(pub, base, sig)).toBe(true);
  });

  const changes: [string, Partial<LiaisonAcceptation>][] = [
    ["another demand", { id: 8 }],
    ["another origin", { origine: "mail" }],
    ["another folder", { dossier: "autre" }],
    ["a title changed by one space", { titre: "Refaire la page " }],
    ["a description changed by one dot", { description: "Avec des tests" }],
    [
      "words moved from the title to the description",
      { titre: "Refaire la", description: "page Avec des tests." },
    ],
    ["another instant, by a millisecond", { decideLe: new Date("2026-11-25T10:00:00.001Z") }],
  ];
  for (const [what, change] of changes) {
    it(`refused for ${what}`, () => {
      expect(verifierLiaison(pub, { ...base, ...change }, sig)).toBe(false);
    });
  }

  it("signed with another key: refused", () => {
    expect(verifierLiaison(pub, base, signerLiaison(otherPriv, base))).toBe(false);
  });

  it("a draft's acceptance, with the same key, never passes for a demand", () => {
    const draft = signAcceptance(priv, {
      id: "7",
      mailUidValidity: "1",
      mailUid: 1,
      draft: "Refaire la page\nAvec des tests.",
      decidedAt: base.decideLe,
    });
    expect(verifierLiaison(pub, base, draft)).toBe(false);
  });
});

describe("never throws, never says yes by mistake", () => {
  const malformees: (string | null)[] = [
    null,
    "",
    "x",
    sig.slice(1),
    `${sig}A`,
    `!${sig.slice(1)}`,
    "A".repeat(86),
  ];
  for (const s of malformees) {
    it(`a malformed signature (${String(s?.length ?? "null")} characters): false`, () => {
      expect(verifierLiaison(pub, base, s)).toBe(false);
    });
  }

  it("a number that is not one, or an instant that is not one: false", () => {
    expect(verifierLiaison(pub, { ...base, id: 0 }, sig)).toBe(false);
    expect(verifierLiaison(pub, { ...base, id: 7.5 }, sig)).toBe(false);
    expect(verifierLiaison(pub, { ...base, decideLe: new Date("nope") }, sig)).toBe(false);
  });

  it("the hash covers where the title ends", () => {
    expect(texteHash("a", "b")).toMatch(/^[0-9a-f]{64}$/);
    expect(texteHash("ab", "c")).not.toBe(texteHash("a", "bc"));
  });
});
