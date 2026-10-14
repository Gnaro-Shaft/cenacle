// npm run serveurs:verifier (2026-10-14): a readable file lists each machine
// and its actions; an absent or refused one is said, with the block number,
// and fails — never an address, a key path or the known_hosts path.
import { describe, expect, it } from "vitest";
import { serversReport } from "./report.ts";

const OK = `known_hosts = "/Users/exemple/.ssh/cenacle/known_hosts"
[[serveur]]
nom = "vps-b"
adresse = "vps-b.exemple.test"
compte = "cenacle"
cles = { services = "/Users/exemple/.ssh/cenacle/vps-b-services", redemarrer = "/Users/exemple/.ssh/cenacle/vps-b-redemarrer" }
[[serveur]]
nom = "noeud-a"
adresse = "192.0.2.10"
compte = "cenacle"
cles = {}
`;

const hidden = /exemple\.test|192\.0\.2|\/Users\//;

describe("checking serveurs.local.toml", () => {
  it("readable: each machine and its actions, nothing else", () => {
    const r = serversReport(OK);
    expect(r.ok).toBe(true);
    expect(r.lines).toEqual([
      "✅ serveurs.local.toml est lisible : 2 machine(s).",
      "   vps-b : services, redemarrer",
      "   noeud-a : aucune clé",
    ]);
    expect(r.lines.join("\n")).not.toMatch(hidden);
  });

  it("absent: said, and fails", () => {
    expect(serversReport(null)).toEqual({
      ok: false,
      lines: ["🛑 serveurs.local.toml est absent."],
    });
  });

  it.each([
    [
      "Legion's ports pasted",
      OK.replace("cles = {}", 'cles = {}\nports = ["tcp/22"]'),
      "cle_inconnue",
      "serveur n°2: unknown key",
    ],
    [
      "a machine without cles",
      OK.replace("cles = {}\n", ""),
      "cles",
      "serveur n°2: cles must be a table",
    ],
    [
      "a relative key path",
      OK.replace("/Users/exemple/.ssh/cenacle/vps-b-services", "vps-b-services"),
      "chemin",
      "serveur n°1: cles.services",
    ],
    ["not TOML", "[[serveur]\nnom =", "toml", "not valid TOML"],
  ])("%s: the kind and the block, and fails", (_label, text, problem, detail) => {
    const r = serversReport(text);
    expect(r.ok).toBe(false);
    expect(r.lines[0]).toBe(`🛑 L'opérateur refuserait ce fichier (${problem}) :`);
    expect(r.lines[1]).toContain(detail);
    expect(r.lines.join("\n")).not.toMatch(hidden);
  });
});
