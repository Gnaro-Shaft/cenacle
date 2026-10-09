// Only the holder of the page's private key can produce an acceptance, and
// only for one proposal, one mail and one exact text (ADR-0013).
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type AcceptanceFields,
  AcceptanceKeyError,
  draftHash,
  generateAcceptanceKeys,
  PRIVATE_KEY_VAR,
  PUBLIC_KEY_VAR,
  privateKeyFromEnv,
  publicKeyFromEnv,
  refusePrivateKey,
  signAcceptance,
  verifyAcceptance,
} from "./acceptance.ts";

const keys = generateAcceptanceKeys();
const env = { [PRIVATE_KEY_VAR]: keys.privateKey, [PUBLIC_KEY_VAR]: keys.publicKey };
const priv = privateKeyFromEnv(env);
const pub = publicKeyFromEnv(env);
const fields: AcceptanceFields = {
  id: "p-1",
  mailUidValidity: "9",
  mailUid: 42,
  draft: "Bonjour Claire,\n\nC'est noté. À bientôt.",
  decidedAt: new Date("2026-10-05T10:00:00.123Z"),
};
const sig = signAcceptance(priv, fields);

describe("acceptance signature", () => {
  it("verifies the exact fields it was made for", () => {
    expect(verifyAcceptance(pub, fields, sig)).toBe(true);
  });

  it.each([
    ["another proposal", { id: "p-2" }],
    ["another mailbox numbering", { mailUidValidity: "10" }],
    ["another mail", { mailUid: 43 }],
    ["a text changed after acceptance", { draft: `${fields.draft} ` }],
    ["another decision time", { decidedAt: new Date("2026-10-05T10:00:00.124Z") }],
  ])("refuses %s", (_label, change) => {
    expect(verifyAcceptance(pub, { ...fields, ...change }, sig)).toBe(false);
  });

  it("refuses a missing, malformed, truncated or foreign signature — never throws", () => {
    const other = generateKeyPairSync("ed25519").privateKey;
    for (const bad of [
      null,
      "",
      "x",
      sig.slice(1),
      `${sig}=`,
      `${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`, // always a real change
      "A".repeat(86),
    ]) {
      expect(verifyAcceptance(pub, fields, bad)).toBe(false);
    }
    expect(verifyAcceptance(pub, fields, signAcceptance(other, fields))).toBe(false);
  });

  it("hashes the UTF-8 text (equality with PostgreSQL is tested on the database)", () => {
    expect(draftHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(draftHash("é")).not.toBe(draftHash("e"));
  });
});

describe("acceptance keys", () => {
  it("are refused when missing, broken or not Ed25519", () => {
    expect(() => privateKeyFromEnv({})).toThrow(AcceptanceKeyError);
    expect(() => publicKeyFromEnv({ [PUBLIC_KEY_VAR]: "" })).toThrow(/npm run keys:accept/);
    expect(() => publicKeyFromEnv({ [PUBLIC_KEY_VAR]: "bm90IGEga2V5" })).toThrow(/not a valid key/);
    const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const der = rsa.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
    expect(() => privateKeyFromEnv({ [PRIVATE_KEY_VAR]: der })).toThrow(/not an Ed25519 key/);
  });

  it("Iris and the executor refuse to start with the private key", () => {
    expect(() => refusePrivateKey("Iris", env)).toThrow(/only the page's server/);
    expect(() => refusePrivateKey("Iris", { [PUBLIC_KEY_VAR]: keys.publicKey })).not.toThrow();
    expect(() => refusePrivateKey("Iris", { [PRIVATE_KEY_VAR]: "" })).not.toThrow();
  });

  it("the public key cannot sign", () => {
    expect(() => signAcceptance(pub, fields)).toThrow();
  });
});
