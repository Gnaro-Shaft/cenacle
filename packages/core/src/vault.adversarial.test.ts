// S1: the secrets backup opens with the right passphrase only, refuses any
// change to the file, and says the same whatever went wrong.
import { describe, expect, it } from "vitest";
import { openSecrets, sealSecrets, VaultError } from "./vault.ts";

const FILES = { ".env": "CENACLE_DB_PORT=1\n", ".env.mail": "CENACLE_MAIL_KEY=secret-key\n" };
const PASS = "une phrase assez longue";
const sealed = sealSecrets(FILES, PASS);

describe("secrets backup", () => {
  it("opens to exactly what was sealed; the file shows no secret in clear", () => {
    expect(openSecrets(sealed, PASS)).toEqual(FILES);
    expect(sealed).not.toContain("secret-key");
    expect(sealed).not.toContain("CENACLE_MAIL_KEY");
  });

  it("two backups of the same files differ (fresh salt and nonce)", () => {
    expect(sealSecrets(FILES, PASS)).not.toBe(sealed);
  });

  it("refuses a short passphrase", () => {
    expect(() => sealSecrets(FILES, "court")).toThrow(/12 characters/);
  });

  it("refuses a wrong passphrase, and any altered field — with one same message", () => {
    const doc = JSON.parse(sealed);
    const flip = (b64: string) => {
      const buf = Buffer.from(b64, "base64");
      buf[0] = (buf[0] ?? 0) ^ 1;
      return buf.toString("base64");
    };
    const attempts = [
      () => openSecrets(sealed, `${PASS}!`),
      () => openSecrets(JSON.stringify({ ...doc, body: flip(doc.body) }), PASS),
      () => openSecrets(JSON.stringify({ ...doc, tag: flip(doc.tag) }), PASS),
      () => openSecrets(JSON.stringify({ ...doc, salt: flip(doc.salt) }), PASS),
      () => openSecrets(JSON.stringify({ ...doc, iv: flip(doc.iv) }), PASS),
    ];
    for (const attempt of attempts) {
      expect(attempt).toThrow(VaultError);
      expect(attempt).toThrow("wrong passphrase, or the backup was altered");
    }
  });

  it("refuses something that is not a backup", () => {
    expect(() => openSecrets("not json", PASS)).toThrow(/not a Cénacle secrets backup/);
    expect(() => openSecrets(JSON.stringify({ magic: "other" }), PASS)).toThrow(/not a Cénacle/);
  });
});
