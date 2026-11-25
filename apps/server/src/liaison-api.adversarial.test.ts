// The « Maison » tab's API (ADR-0048): only the page, with the token of this
// run, from this machine; my acceptance signs exactly the text I was shown,
// or nothing; a folder not declared is refused; a refusal names a category,
// never the text; an internal error says nothing more, and its log line never
// quotes a demand.
import {
  generateAcceptanceKeys,
  type LiaisonAcceptation,
  privateKeyFromEnv,
  publicKeyFromEnv,
  signerLiaison,
  validerTexteDemande,
  verifierLiaison,
} from "@cenacle/core";
import { type Demande, LiaisonDemandeError, type LiaisonDemandes } from "@cenacle/journal";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { defaultGuardConfig } from "./guard.ts";
import { createLiaisonService } from "./liaison-service.ts";

const TOKEN = "s3cr3t-token-of-this-run-xxxxxxxxxxxxxxxxxx";
const keys = generateAcceptanceKeys();
const priv = privateKeyFromEnv({ CENACLE_ACCEPT_PRIVATE_KEY: keys.privateKey });
const pub = publicKeyFromEnv({ CENACLE_ACCEPT_PUBLIC_KEY: keys.publicKey });
const NOW = new Date("2026-11-25T12:00:00Z");
const PAGE = {
  host: "127.0.0.1:8787",
  origin: "http://127.0.0.1:8787",
  authorization: `Bearer ${TOKEN}`,
  "content-type": "application/json",
};

let rows: Map<number, Demande>;
let signed: LiaisonAcceptation[];
let logs: string[];
let boom: boolean;

function fakeStore(): LiaisonDemandes {
  const must = (id: number) => {
    const d = rows.get(id);
    if (d === undefined) throw new LiaisonDemandeError("introuvable", `demande ${id} inconnue`);
    return d;
  };
  const store: Partial<LiaisonDemandes> = {
    get: async (id) => rows.get(id) ?? null,
    recent: async () => [...rows.values()],
    create: async (t, dossier) => {
      if (boom) throw new Error("connect ECONNREFUSED Refaire la page secrète");
      const v = validerTexteDemande(t);
      const d: Demande = {
        id: rows.size + 1,
        creeLe: NOW,
        origine: "directe",
        mailRef: null,
        dossier,
        titre: v.titre,
        description: v.description,
        statut: "attente",
        decideLe: null,
        partirApres: null,
        prisLe: null,
        closLe: null,
        signature: null,
        ticket: null,
        categorie: null,
      };
      rows.set(d.id, d);
      return d;
    },
    edit: async (id, t, dossier) => {
      const d = { ...must(id), ...validerTexteDemande(t), dossier };
      rows.set(id, d);
      return d;
    },
    accept: async (id, s) => {
      const d: Demande = {
        ...must(id),
        statut: "acceptee",
        signature: s.signature,
        decideLe: s.decideLe,
      };
      rows.set(id, d);
      return d;
    },
    refuse: async (id) => must(id),
    cancel: async (id) => must(id),
  };
  return store as LiaisonDemandes;
}

function setup() {
  return createApp({
    readAfter: async () => [],
    guard: defaultGuardConfig(TOKEN),
    proposals: {
      list: async () => [],
      edit: async () => {},
      accept: async () => {},
      refuse: async () => {},
      cancel: async () => {},
    },
    log: (line) => void logs.push(line),
    liaison: createLiaisonService({
      demandes: fakeStore(),
      etats: { all: async () => [] },
      sign: (a) => {
        signed.push(a);
        return signerLiaison(priv, a);
      },
      interrupteur: () => "actif",
      dossiers: () => ({ ok: ["maison-etalon"] }),
      derniereLecture: async () => null,
      now: () => NOW,
    }),
  });
}

beforeEach(() => {
  rows = new Map();
  signed = [];
  logs = [];
  boom = false;
});

const send = (
  app: ReturnType<typeof setup>,
  path: string,
  body: unknown,
  headers: Record<string, string> = PAGE,
) => app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
const TEXTE = {
  titre: "Refaire la page",
  description: "Avec des tests.",
  dossier: "maison-etalon",
};

describe("only the page, with this run's token, from this machine", () => {
  it("no token, another origin, another host, another token: refused before the service", async () => {
    const app = setup();
    const { authorization: _a, ...noToken } = PAGE;
    for (const headers of [
      noToken,
      { ...PAGE, origin: "http://evil.example" },
      { ...PAGE, host: "evil.example" },
      { ...PAGE, authorization: "Bearer autre" },
    ]) {
      const r = await send(app, "/api/liaison/demandes", TEXTE, headers);
      expect(r.status).toBeGreaterThanOrEqual(400);
    }
    expect((await app.request("/api/liaison", { headers: { host: PAGE.host } })).status).toBe(401);
    expect(rows.size).toBe(0);
  });

  it("an id that is not one: 404; a body too large: 413; not JSON: 400", async () => {
    const app = setup();
    expect((await send(app, "/api/liaison/demandes/abc/accepter", TEXTE)).status).toBe(404);
    expect((await send(app, "/api/liaison/demandes/0/accepter", TEXTE)).status).toBe(404);
    const big = { ...TEXTE, description: "x".repeat(30_000) };
    expect((await send(app, "/api/liaison/demandes", big)).status).toBe(413);
    const r = await app.request("/api/liaison/demandes", {
      method: "POST",
      headers: PAGE,
      body: "{",
    });
    expect(r.status).toBe(400);
  });
});

describe("my acceptance signs exactly what I was shown", () => {
  it("created, then accepted: the signature covers this text, this folder, this instant", async () => {
    const app = setup();
    const r = await send(app, "/api/liaison/demandes", TEXTE);
    const { id } = (await r.json()) as { id: number };
    expect((await send(app, `/api/liaison/demandes/${id}/accepter`, TEXTE)).status).toBe(200);
    expect(signed).toEqual([{ id, origine: "directe", ...TEXTE, decideLe: NOW }]);
    const d = rows.get(id) as Demande;
    expect(verifierLiaison(pub, signed[0] as LiaisonAcceptation, d.signature)).toBe(true);
  });

  it("a text that changed since it was shown: 409, nothing signed", async () => {
    const app = setup();
    await send(app, "/api/liaison/demandes", TEXTE);
    const r = await send(app, "/api/liaison/demandes/1/accepter", { ...TEXTE, titre: "Autre" });
    expect(r.status).toBe(409);
    expect(signed).toEqual([]);
    expect(rows.get(1)?.statut).toBe("attente");
  });

  it("a folder not declared: 409, nothing kept", async () => {
    const app = setup();
    const r = await send(app, "/api/liaison/demandes", { ...TEXTE, dossier: "autre" });
    expect(r.status).toBe(409);
    expect(rows.size).toBe(0);
  });
});

describe("refusals and errors never quote the text", () => {
  it("a third party's data: 409 with the category only", async () => {
    const app = setup();
    const r = await send(app, "/api/liaison/demandes", {
      ...TEXTE,
      description: "écrire à jean@exemple.org",
    });
    expect(r.status).toBe(409);
    const body = JSON.stringify(await r.json());
    expect(body).toContain("courriel");
    expect(body).not.toContain("jean");
  });

  it("an internal error: 500 'internal error', and the log never quotes the demand", async () => {
    const app = setup();
    boom = true;
    const r = await send(app, "/api/liaison/demandes", TEXTE);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "internal error" });
    expect(logs.join("\n")).not.toContain("secrète");
  });

  it("the view says the switch, the folders, the reading", async () => {
    const app = setup();
    const r = await app.request("/api/liaison", { headers: PAGE });
    expect(await r.json()).toMatchObject({
      actif: "actif",
      dossiers: ["maison-etalon"],
      config: null,
      lecture: null,
    });
  });
});
