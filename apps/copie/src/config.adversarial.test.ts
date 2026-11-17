// ADR-0044: copie.local.toml holds no secret and nothing loose. A private age
// key pasted by mistake is refused without being repeated; every field is
// checked; a path that could split the ssh command line is refused.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CopieConfigError, parseCopieConfig, plainWord, pushKeyPath } from "./config.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const RECIPIENT = `age1${"q".repeat(58)}`;
const GOOD = {
  destinataire: RECIPIENT,
  known_hosts: "/Users/exemple/.ssh/cenacle/known_hosts",
  adresse: "sauvegarde.exemple.test",
  compte: "cenacle-depot",
};
const toml = (o: Record<string, unknown>) =>
  Object.entries(o)
    .map(([k, v]) => `${k} = ${typeof v === "string" ? JSON.stringify(v) : String(v)}`)
    .join("\n");

describe("copie.local.toml", () => {
  it("the example is valid, port 22 by default", () => {
    const text = readFileSync(join(ROOT, "copie.local.example.toml"), "utf8");
    expect(parseCopieConfig(text)).toEqual({
      recipient: RECIPIENT,
      knownHosts: GOOD.known_hosts,
      address: GOOD.adresse,
      port: 22,
      account: GOOD.compte,
    });
    expect(parseCopieConfig(toml({ ...GOOD, port: 2222 })).port).toBe(2222);
  });

  it("a private key in place of the public one is refused, and never repeated", () => {
    const pasted = `AGE-SECRET-KEY-1${"Q".repeat(58)}`;
    for (const value of [pasted, ` ${pasted.toLowerCase()}`]) {
      try {
        parseCopieConfig(toml({ ...GOOD, destinataire: value }));
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(CopieConfigError);
        expect(String(error)).toMatch(/PRIVATE key/);
        expect(String(error).toLowerCase()).not.toContain("q".repeat(10));
      }
    }
  });

  it.each([
    ["no recipient", { destinataire: undefined }],
    ["a recipient too short", { destinataire: `age1${"q".repeat(57)}` }],
    ["a recipient out of bech32 (b, i, o)", { destinataire: `age1${"b".repeat(58)}` }],
    ["an ssh key as recipient", { destinataire: "ssh-ed25519 AAAAC3Nza" }],
    ["a host name with a space", { adresse: "sauvegarde exemple" }],
    ["a host name that is an option", { adresse: "-oProxyCommand=x" }],
    ["a user@host", { adresse: "root@sauvegarde.exemple.test" }],
    ["root", { compte: "root" }],
    ["an account with a space", { compte: "cenacle depot" }],
    ["port 0", { port: 0 }],
    ["port 70000", { port: 70000 }],
    ["a port as text", { port: "22" }],
    ["a relative known_hosts", { known_hosts: ".ssh/known_hosts" }],
    ["a known_hosts with a space", { known_hosts: "/Users/ex emple/kh" }],
    ["a known_hosts with ..", { known_hosts: "/Users/exemple/../kh" }],
    ["a known_hosts with a quote", { known_hosts: "/Users/exemple/k'h" }],
    ["a known_hosts with $", { known_hosts: "/Users/$HOME/kh" }],
  ])("%s: refused", (_what, change) => {
    const o: Record<string, unknown> = { ...GOOD, ...change };
    for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
    expect(() => parseCopieConfig(toml(o))).toThrow(CopieConfigError);
  });

  it("an unknown key is refused without being named (it is the file's text)", () => {
    const run = () => parseCopieConfig(`${toml(GOOD)}\nmot_de_passe_oublie = "x"`);
    expect(run).toThrow(CopieConfigError);
    expect(run).not.toThrow(/mot_de_passe_oublie/);
    expect(() => parseCopieConfig("destinataire = ")).toThrow(/not valid TOML/);
  });
});

describe("the push key", () => {
  it("is one fixed file under ~/.ssh/cenacle", () => {
    expect(pushKeyPath("/Users/exemple")).toBe("/Users/exemple/.ssh/cenacle/copie-pousser");
  });

  it("plainWord refuses what rsync's -e would split", () => {
    expect(plainWord("/a/b", "x")).toBe("/a/b");
    for (const bad of ["/a b", "/a\tb", "/a\\b", '/a"b', "/a`b", "a/b", "/a/./b", 3]) {
      expect(() => plainWord(bad, "x")).toThrow(CopieConfigError);
    }
  });
});
