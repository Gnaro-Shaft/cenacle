// The line written on the VM (ADR-0048): the public key alone, of the exact
// ed25519 form and our comment, under the forced command — nothing that could
// widen what the key may do (no option slipped in, no second key, no line break).
import { describe, expect, it } from "vitest";
import { FORCED, ligneAutorisee } from "./cle.ts";

const PUB = `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${"A".repeat(43)} cenacle-liaison`;

describe("the authorized_keys line", () => {
  it("the forced command, then the public key", () => {
    expect(ligneAutorisee(`${PUB}\n`)).toBe(`${FORCED} ${PUB}`);
    expect(FORCED).toBe('restrict,command="/opt/maison/liaison/maison-liaison"');
  });

  it.each([
    ["another type of key", PUB.replace("ssh-ed25519", "ssh-rsa")],
    ["another comment", PUB.replace("cenacle-liaison", "autre")],
    ["an option slipped in front", `from="*" ${PUB}`],
    ["two keys", `${PUB}\n${PUB}\n`],
    ["a private key", "-----BEGIN OPENSSH PRIVATE KEY-----\nxxx\n"],
    ["a key too short", PUB.replace("A".repeat(43), "A".repeat(42))],
    ["empty", ""],
  ])("%s: refused", (_what, text) => {
    expect(ligneAutorisee(text)).toBeNull();
  });
});
