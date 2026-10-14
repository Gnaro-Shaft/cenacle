// The operator's state, written at each pass (2026-10-14): whole, readable by
// me only, nothing left behind; the list's kind of problem or "ok" — never a
// value from serveurs.local.toml. And the pass writes it before anything else.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOperatorState, parseServers } from "@cenacle/securite";
import { afterAll, describe, expect, it } from "vitest";
import { publishState } from "./state.ts";

const BASE = mkdtempSync(join(tmpdir(), "cenacle-operateur-etat-"));
afterAll(() => rmSync(BASE, { recursive: true, force: true }));
const NOW = Date.parse("2026-10-14T12:00:00Z");

const CONFIG = parseServers(`known_hosts = "/Users/exemple/.ssh/cenacle/known_hosts"
[[serveur]]
nom = "vps-b"
adresse = "vps-b.exemple.test"
compte = "cenacle"
cles = { services = "/Users/exemple/.ssh/cenacle/vps-b-services" }
`);

describe("the state the operator leaves", () => {
  it("a usable list: ok, the instant, and nothing from the list", () => {
    const path = join(BASE, "ok.etat");
    publishState(path, CONFIG, NOW);
    const text = readFileSync(path, "utf8");
    expect(parseOperatorState(text)).toEqual({ instantMs: NOW, config: "ok" });
    expect(text).not.toMatch(/vps-b|exemple|Users|cenacle/);
  });

  it("a blocked list: its kind", () => {
    const path = join(BASE, "bloque.etat");
    publishState(path, "cle_inconnue", NOW);
    expect(parseOperatorState(readFileSync(path, "utf8"))).toEqual({
      instantMs: NOW,
      config: "cle_inconnue",
    });
  });

  it("readable by me only, written over the last one, no temporary file left", () => {
    const dir = mkdtempSync(join(BASE, "seul-"));
    const path = join(dir, "operateur.etat");
    writeFileSync(path, "ancien", { mode: 0o644 });
    publishState(path, "absent", NOW);
    publishState(path, CONFIG, NOW + 60_000);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(parseOperatorState(readFileSync(path, "utf8"))?.config).toBe("ok");
    expect(readdirSync(dir)).toEqual(["operateur.etat"]);
  });

  it("the pass says its state first, before any request is looked at", () => {
    const main = readFileSync(join(import.meta.dirname, "main.ts"), "utf8");
    const said = main.indexOf("publishState(OPERATOR_STATE_PATH, config, Date.now())");
    expect(said).toBeGreaterThan(0);
    expect(said).toBeLessThan(main.indexOf("await runOperator("));
  });
});
