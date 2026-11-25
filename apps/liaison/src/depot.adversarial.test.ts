// Handing demands over (ADR-0048, point 5), against a stand-in for the VM's
// forced command — a local script that reads the demand and answers as the
// house would. Once, never guessed: a demand without the page's signature, or
// whose text changed, never leaves and never takes a claim; a line cut on the
// way is "state unknown", never sent again; no title ever reaches Telegram or
// the journal.
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateAcceptanceKeys,
  privateKeyFromEnv,
  publicKeyFromEnv,
  signerLiaison,
  verifierLiaison,
} from "@cenacle/core";
import { type Demande, LiaisonDemandeError } from "@cenacle/journal";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { type DepotDeps, transmettre } from "./depot.ts";
import { MAX_DEPOT } from "./reponse.ts";
import { appeler } from "./ssh.ts";

const BASE = mkdtempSync(join(tmpdir(), "cenacle-liaison-depot-"));
afterAll(() => rmSync(BASE, { recursive: true, force: true }));
const keys = generateAcceptanceKeys();
const priv = privateKeyFromEnv({ CENACLE_ACCEPT_PRIVATE_KEY: keys.privateKey });
const pub = publicKeyFromEnv({ CENACLE_ACCEPT_PUBLIC_KEY: keys.publicKey });
const TITRE = "Refaire la page secrète";
const NOW = new Date("2026-11-25T12:00:00Z");

/** The VM's stand-in: records what it received, then runs `body`. */
let recus = "";
let n = 0;
function vm(body: string): string {
  const file = join(BASE, `vm-${++n}`);
  writeFileSync(file, `#!/bin/sh\ncat > "$(mktemp "${recus}/recu.XXXXXX")"\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}
const deposes = () => readdirSync(recus).map((f) => readFileSync(join(recus, f), "utf8"));

/** An in-memory store with the table's rules that matter here. */
class Faux {
  rows = new Map<number, Demande>();
  prises: Date[] = [];
  add(over: Partial<Demande> = {}, sign = true): Demande {
    const id = this.rows.size + 1;
    const decideLe = new Date(NOW.getTime() - 3 * 60_000);
    const d: Demande = {
      id,
      creeLe: decideLe,
      origine: "directe",
      mailRef: null,
      dossier: "maison-etalon",
      titre: TITRE,
      description: "Avec des tests.",
      statut: "acceptee",
      decideLe,
      partirApres: new Date(decideLe.getTime() + 120_000),
      prisLe: null,
      closLe: null,
      signature: null,
      ticket: null,
      categorie: null,
      ...over,
    };
    const fields = { ...d, titre: d.titre ?? "", description: d.description ?? "", decideLe };
    const row = { ...d, signature: sign ? signerLiaison(priv, fields) : "A".repeat(86) };
    this.rows.set(id, row);
    return row;
  }
  set(id: number, over: Partial<Demande>) {
    this.rows.set(id, { ...this.get(id), ...over });
  }
  get = (id: number) => this.rows.get(id) as Demande;
  demandes: DepotDeps["demandes"] = {
    due: async (now) =>
      [...this.rows.values()].filter(
        (d) => d.statut === "acceptee" && (d.partirApres?.getTime() ?? 0) <= now.getTime(),
      ),
    claim: async (id, now) => {
      if (this.get(id).statut !== "acceptee") return false;
      if (this.prises.length >= 10) throw new LiaisonDemandeError("plafond", "plafond");
      this.prises.push(now);
      this.set(id, { statut: "en_cours", prisLe: now });
      return true;
    },
    refuseUnclaimed: async (id, categorie, now) => {
      if (this.get(id).statut !== "acceptee") return false;
      this.set(id, { statut: "echouee", categorie, closLe: now });
      return true;
    },
    close: async (id, issue, now) => {
      if (this.get(id).statut !== "en_cours") return false;
      this.set(
        id,
        "ticket" in issue
          ? { statut: "transmise", ticket: issue.ticket, closLe: now }
          : { statut: "echouee", categorie: issue.categorie, closLe: now },
      );
      return true;
    },
    lapse: async () => 0,
    bloquees: async (avant) =>
      [...this.rows.values()].filter(
        (d) => d.statut === "en_cours" && (d.prisLe?.getTime() ?? 0) < avant.getTime(),
      ),
  };
}

let store: Faux;
let messages: string[];
let events: { type: string; payload: Record<string, unknown> }[];
beforeEach(() => {
  store = new Faux();
  messages = [];
  events = [];
  recus = mkdtempSync(join(BASE, "recus-"));
});

const deps = (stand: string, over: Partial<DepotDeps> = {}): DepotDeps => ({
  demandes: store.demandes,
  signee: (d) =>
    d.decideLe !== null &&
    verifierLiaison(
      pub,
      { ...d, titre: d.titre ?? "", description: d.description ?? "", decideLe: d.decideLe },
      d.signature,
    ),
  dossiers: ["maison-etalon"],
  deposer: (json) => appeler([], json, MAX_DEPOT, stand, 2_000),
  journal: { append: async (e) => void events.push(e) },
  send: async (t) => void messages.push(t),
  // As the journal says it: the last time the ceiling was said.
  plafondDitLe: async () => (events.some((e) => e.type === "liaison.plafond") ? NOW : null),
  now: () => NOW,
  ...over,
});
const OK = 'echo \'{"ok": true, "ticket": "GNA-22"}\'';

describe("handed over once", () => {
  it("signed: the four keys leave, the ticket comes back, a second pass sends nothing", async () => {
    const d = store.add();
    const stand = vm(OK);
    expect(await transmettre(deps(stand))).toMatchObject({ transmises: 1 });
    expect(await transmettre(deps(stand))).toMatchObject({ transmises: 0 });
    expect(deposes()).toHaveLength(1);
    expect(JSON.parse(deposes()[0] ?? "")).toEqual({
      titre: TITRE,
      description: "Avec des tests.",
      origine: "directe",
      dossier: "maison-etalon",
    });
    expect(store.get(d.id)).toMatchObject({ statut: "transmise", ticket: "GNA-22" });
    expect(messages).toEqual(["✅ Demande n° 1 transmise à la maison : GNA-22."]);
  });

  it("never a title in a message or the journal", async () => {
    store.add();
    store.add({}, false);
    await transmettre(deps(vm(OK)));
    for (const t of [...messages, ...events.map((e) => JSON.stringify(e))]) {
      expect(t).not.toContain("secrète");
      expect(t).not.toContain("Avec des tests");
    }
  });
});

describe("refused before leaving, without a claim", () => {
  const cas: [string, (f: Faux) => Demande, string][] = [
    ["written accepted without the page", (f) => f.add({}, false), "non_signee"],
    [
      "its text changed after my acceptance",
      (f) => {
        const d = f.add();
        f.set(d.id, { titre: "Autre" });
        return d;
      },
      "non_signee",
    ],
    [
      "its folder changed after my acceptance",
      (f) => {
        const d = f.add();
        f.set(d.id, { dossier: "autre" });
        return d;
      },
      "non_signee",
    ],
    ["its folder no longer declared", (f) => f.add({ dossier: "ancien" }), "dossier"],
    [
      "a third party's data, signed",
      (f) => f.add({ description: "à jean@exemple.org" }),
      "courriel",
    ],
    ["a control character, signed", (f) => f.add({ titre: "a‮b" }), "controle"],
  ];
  for (const [what, make, categorie] of cas) {
    it(`${what}: ${categorie}`, async () => {
      const d = make(store);
      const r = await transmettre(deps(vm(OK)));
      expect(r).toMatchObject({ refusees: 1, transmises: 0 });
      expect(deposes()).toHaveLength(0);
      expect(store.prises).toHaveLength(0);
      expect(store.get(d.id)).toMatchObject({ statut: "echouee", categorie, prisLe: null });
      expect(messages[0]).toMatch(/Rien n'est parti/);
    });
  }
});

describe("the house's answer, or none", () => {
  it("cut off on the way: state unknown, said, never sent again", async () => {
    const d = store.add();
    const stand = vm("sleep 5");
    expect(await transmettre(deps(stand))).toMatchObject({ echouees: 1 });
    expect(store.get(d.id)).toMatchObject({ statut: "echouee", categorie: "transport" });
    expect(messages[0]).toMatch(/peut-être été déposée/);
    await transmettre(deps(stand));
    expect(deposes()).toHaveLength(1);
  }, 15_000);

  it("a refusal: its category, never the house's reason", async () => {
    const d = store.add();
    const body = 'echo \'{"ok": false, "categorie": "courriel", "motif": "jean@x"}\'; exit 1';
    await transmettre(deps(vm(body)));
    expect(store.get(d.id)).toMatchObject({ statut: "echouee", categorie: "courriel" });
    expect(messages.join()).not.toContain("jean");
  });

  const mal: [string, string][] = [
    ["two lines", `${OK}; ${OK}`],
    ["a ticket of the wrong form", 'echo \'{"ok": true, "ticket": "x"}\''],
    ["ok with exit code 1", `${OK}; exit 1`],
    ["nothing at all", "true"],
  ];
  for (const [what, body] of mal) {
    it(`${what}: reponse, state unknown`, async () => {
      const d = store.add();
      await transmettre(deps(vm(body)));
      expect(store.get(d.id)).toMatchObject({ statut: "echouee", categorie: "reponse" });
    });
  }

  it("ssh that cannot start: nothing left", async () => {
    const d = store.add();
    await transmettre(deps(join(BASE, "absent")));
    expect(store.get(d.id)).toMatchObject({ statut: "echouee", categorie: "ssh" });
    expect(messages[0]).toMatch(/rien n'est parti/);
  });

  it("a pass cut off between the claim and the close: closed as unknown, not sent", async () => {
    const d = store.add();
    store.set(d.id, { statut: "en_cours", prisLe: new Date(NOW.getTime() - 20 * 60_000) });
    await transmettre(deps(vm(OK)));
    expect(deposes()).toHaveLength(0);
    expect(store.get(d.id)).toMatchObject({ statut: "echouee", categorie: "transport" });
  });

  it("Telegram away: the demand is closed all the same", async () => {
    const d = store.add();
    await transmettre(deps(vm(OK), { send: async () => Promise.reject(new Error("down")) }));
    expect(store.get(d.id).statut).toBe("transmise");
  });
});

describe("the ceiling", () => {
  it("the 11th waits; said once, not at every pass", async () => {
    for (let i = 0; i < 12; i++) store.add();
    const stand = vm(OK);
    expect((await transmettre(deps(stand))).transmises).toBe(10);
    await transmettre(deps(stand));
    expect(messages.filter((m) => m.startsWith("⏸"))).toHaveLength(1);
    expect(deposes()).toHaveLength(10);
    expect([...store.rows.values()].filter((d) => d.statut === "acceptee")).toHaveLength(2);
  });
});
