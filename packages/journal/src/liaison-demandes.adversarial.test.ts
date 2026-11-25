// The demands to the house (ADR-0048), in the real database, with the
// application role every program shares: the life cycle is the table's. A
// demand is born waiting and never accepted without the text signed; a closed
// one never changes but for its text wiped; an open one is never erased; the
// undo delay, the 24-hour limit and the ceiling of 10 are the database's too.
import {
  generateAcceptanceKeys,
  LiaisonTexteRefus,
  privateKeyFromEnv,
  publicKeyFromEnv,
  signerLiaison,
  texteHash,
  verifierLiaison,
} from "@cenacle/core";
import { afterAll, describe, expect, it } from "vitest";
import { createLiaisonDemandes, type Demande, LiaisonDemandeError } from "./liaison-demandes.ts";
import { appConnection } from "./test-db.ts";

const sql = appConnection();
afterAll(async () => {
  await sql.end();
});
const store = createLiaisonDemandes(sql);
const keys = generateAcceptanceKeys();
const priv = privateKeyFromEnv({ CENACLE_ACCEPT_PRIVATE_KEY: keys.privateKey });
const pub = publicKeyFromEnv({ CENACLE_ACCEPT_PUBLIC_KEY: keys.publicKey });
const DOSSIER = "maison-etalon";
const minutes = (n: number) => new Date(Date.now() + n * 60_000);

const nouvelle = (titre = "Refaire la page", description = "Avec des tests.") =>
  store.create({ titre, description }, DOSSIER);

/** As the page does it: the text it shows, signed, at `decideLe`. */
const accepter = (
  d: Demande,
  decideLe: Date,
  texte = { titre: d.titre, description: d.description },
) => {
  const fields = {
    id: d.id,
    origine: d.origine,
    dossier: d.dossier,
    titre: texte.titre ?? "",
    description: texte.description ?? "",
    decideLe,
  };
  return store.accept(d.id, {
    texteHash: texteHash(fields.titre, fields.description),
    dossier: d.dossier,
    signature: signerLiaison(priv, fields),
    decideLe,
  });
};
/** Accepted 3 minutes ago: the undo delay is over, it may be taken now. */
const acceptee = async () => accepter(await nouvelle(), minutes(-3));
const count = async () =>
  ((await sql`select count(*)::int as n from liaison_demandes`)[0]?.n as number) ?? 0;

describe("born, edited, accepted on the page", () => {
  it("kept as typed, trimmed, waiting, with nothing decided", async () => {
    const d = await nouvelle("  Refaire la page  ", "\n Avec des tests. \n");
    expect(d).toMatchObject({ titre: "Refaire la page", description: "Avec des tests." });
    expect(d).toMatchObject({
      statut: "attente",
      origine: "directe",
      signature: null,
      decideLe: null,
    });
  });

  it("a third party's data is refused before the database: nothing is kept", async () => {
    const before = await count();
    await expect(nouvelle("Écrire à jean@exemple.org")).rejects.toBeInstanceOf(LiaisonTexteRefus);
    await expect(nouvelle("t", "appeler le 06 12 34 56 78")).rejects.toBeInstanceOf(
      LiaisonTexteRefus,
    );
    await expect(store.create({ titre: "t", description: "d" }, "../etc")).rejects.toBeInstanceOf(
      LiaisonDemandeError,
    );
    expect(await count()).toBe(before);
  });

  it("edited while waiting, and the edit is checked too", async () => {
    const d = await nouvelle();
    const e = await store.edit(d.id, { titre: "Nouveau titre", description: "Nouvelle" }, DOSSIER);
    expect(e.titre).toBe("Nouveau titre");
    await expect(
      store.edit(d.id, { titre: "t", description: "voir www.exemple" }, DOSSIER),
    ).rejects.toBeInstanceOf(LiaisonTexteRefus);
  });

  it("accepted with the signature of the text shown; the signature checks out", async () => {
    const d = await nouvelle();
    const a = await accepter(d, new Date());
    expect(a.statut).toBe("acceptee");
    expect(a.partirApres?.getTime()).toBe((a.decideLe?.getTime() ?? 0) + 120_000);
    const ok = verifierLiaison(
      pub,
      {
        ...a,
        titre: a.titre ?? "",
        description: a.description ?? "",
        decideLe: a.decideLe as Date,
      },
      a.signature,
    );
    expect(ok).toBe(true);
  });

  it("a text changed between my reading and my acceptance: refused, still waiting", async () => {
    const d = await nouvelle();
    await store.edit(d.id, { titre: "Changé par ailleurs", description: "x" }, DOSSIER);
    await expect(accepter(d, new Date())).rejects.toMatchObject({ kind: "texte_change" });
    expect((await store.get(d.id))?.statut).toBe("attente");
  });

  it("once accepted, the text cannot be edited, nor accepted twice", async () => {
    const d = await acceptee();
    await expect(store.edit(d.id, { titre: "t", description: "d" }, DOSSIER)).rejects.toMatchObject(
      {
        kind: "etat",
      },
    );
    await expect(accepter(d, new Date())).rejects.toMatchObject({ kind: "etat" });
  });

  it("an unknown number: introuvable, never a crash", async () => {
    await expect(store.refuse(999_999_999, new Date())).rejects.toMatchObject({
      kind: "introuvable",
    });
    await expect(store.edit(-1, { titre: "t", description: "d" }, DOSSIER)).rejects.toMatchObject({
      kind: "introuvable",
    });
    expect(await store.get(0)).toBeNull();
  });
});

describe("the undo delay, the claim, the close", () => {
  it("cancelled within 2 minutes; past them, refused — by the database's clock too", async () => {
    const fresh = await accepter(await nouvelle(), new Date());
    expect((await store.cancel(fresh.id, new Date())).statut).toBe("annulee");
    const old = await acceptee();
    await expect(store.cancel(old.id, new Date())).rejects.toMatchObject({ kind: "etat" });
    // Our clock lying (an instant before the delay ends): the database refuses still.
    await expect(store.cancel(old.id, minutes(-2.5))).rejects.toMatchObject({ kind: "etat" });
  });

  it("taken once, then handed over with its ticket; then nothing changes", async () => {
    const d = await acceptee();
    expect(await store.claim(d.id, new Date())).toBe(true);
    expect(await store.claim(d.id, new Date())).toBe(false);
    expect(await store.close(d.id, { ticket: "GNA-22" }, new Date())).toBe(true);
    expect(await store.close(d.id, { categorie: "transport" }, new Date())).toBe(false);
    expect(await store.get(d.id)).toMatchObject({ statut: "transmise", ticket: "GNA-22" });
  });

  it("not taken before the undo delay ends (the database refuses)", async () => {
    const d = await accepter(await nouvelle(), new Date());
    await expect(store.claim(d.id, new Date())).rejects.toMatchObject({ code: "42501" });
    expect((await store.get(d.id))?.statut).toBe("acceptee");
  });

  it("not taken 24 hours after my decision: it lapses instead", async () => {
    const d = await accepter(await nouvelle(), minutes(-24 * 60 - 1));
    await expect(store.claim(d.id, new Date())).rejects.toMatchObject({ code: "42501" });
    expect(await store.lapse(new Date())).toBeGreaterThanOrEqual(1);
    expect((await store.get(d.id))?.statut).toBe("caduque");
  });

  it("refused before being taken: failed, without a claim, the ceiling untouched", async () => {
    const d = await acceptee();
    const since = minutes(-24 * 60);
    const taken = await store.takenSince(since);
    expect(await store.refuseUnclaimed(d.id, "non_signee", new Date())).toBe(true);
    expect(await store.get(d.id)).toMatchObject({ statut: "echouee", prisLe: null });
    expect(await store.takenSince(since)).toBe(taken);
  });

  it("a ticket or a category of the wrong form is refused by the table", async () => {
    const d = await acceptee();
    await store.claim(d.id, new Date());
    await expect(store.close(d.id, { ticket: "gna-22; drop" }, new Date())).rejects.toBeDefined();
    await expect(store.close(d.id, { categorie: "Paperclip!" }, new Date())).rejects.toBeDefined();
    expect(await store.close(d.id, { categorie: "paperclip" }, new Date())).toBe(true);
  });
});

describe("in direct SQL, with the application role", () => {
  const raw = (q: Promise<unknown>) =>
    expect(q).rejects.toMatchObject({ code: expect.any(String) });

  it("a demand is never born accepted, decided, taken or with the origin `mail`", async () => {
    await raw(sql`insert into liaison_demandes (origine, dossier, titre, description, statut)
                  values ('directe', 'd', 't', 'd', 'acceptee')`);
    await raw(sql`insert into liaison_demandes (origine, dossier, titre, description, signature)
                  values ('directe', 'd', 't', 'd', ${"A".repeat(86)})`);
    await raw(sql`insert into liaison_demandes (origine, dossier, titre, description)
                  values ('mail', 'd', 't', 'd')`);
    await raw(sql`insert into liaison_demandes (origine, dossier, titre, description)
                  values ('directe', 'd', ${"t\nt"}, 'd')`);
  });

  it("an acceptance written without the page carries no valid signature", async () => {
    const d = await nouvelle();
    const forged = "A".repeat(86);
    await sql`update liaison_demandes set statut = 'acceptee', decide_le = now(),
              partir_apres = now() + interval '2 minutes', signature = ${forged}
              where id = ${d.id}`;
    const row = await store.get(d.id);
    const fields = {
      ...d,
      titre: d.titre ?? "",
      description: d.description ?? "",
      decideLe: row?.decideLe as Date,
    };
    expect(verifierLiaison(pub, fields, row?.signature ?? null)).toBe(false);
  });

  it("no state is skipped, none goes back", async () => {
    const d = await nouvelle();
    await raw(sql`update liaison_demandes set statut = 'transmise', ticket = 'GNA-1',
                  decide_le = now(), pris_le = now(), clos_le = now(), signature = ${"A".repeat(86)}
                  where id = ${d.id}`);
    const c = await accepter(await nouvelle(), new Date());
    await store.cancel(c.id, new Date());
    await raw(
      sql`update liaison_demandes set statut = 'acceptee', clos_le = null where id = ${c.id}`,
    );
  });

  it("once decided, the text, the folder, the signature and the instant never change", async () => {
    const d = await acceptee();
    await raw(sql`update liaison_demandes set titre = 'Autre' where id = ${d.id}`);
    await raw(sql`update liaison_demandes set dossier = 'autre' where id = ${d.id}`);
    await raw(sql`update liaison_demandes set signature = ${"B".repeat(86)} where id = ${d.id}`);
    await raw(sql`update liaison_demandes set decide_le = now() where id = ${d.id}`);
  });

  it("the undo delay is at least 2 minutes", async () => {
    const d = await nouvelle();
    await raw(sql`update liaison_demandes set statut = 'acceptee', decide_le = now(),
                  partir_apres = now() + interval '1 minute', signature = ${"A".repeat(86)}
                  where id = ${d.id}`);
  });

  it("refused before a claim never invents one", async () => {
    const d = await acceptee();
    await raw(sql`update liaison_demandes set statut = 'echouee', categorie = 'x',
                  pris_le = now(), clos_le = now() where id = ${d.id}`);
  });

  it("a closed demand changes only by its whole text wiped", async () => {
    const d = await nouvelle();
    await store.refuse(d.id, new Date());
    await raw(sql`update liaison_demandes set titre = null where id = ${d.id}`);
    await raw(sql`update liaison_demandes set categorie = 'x' where id = ${d.id}`);
    await sql`update liaison_demandes set titre = null, description = null where id = ${d.id}`;
    expect(await store.get(d.id)).toMatchObject({
      titre: null,
      description: null,
      statut: "refusee",
    });
  });

  it("an open demand is never erased", async () => {
    const waiting = await nouvelle();
    const accepted = await acceptee();
    await raw(sql`delete from liaison_demandes where id = ${waiting.id}`);
    await raw(sql`delete from liaison_demandes where id = ${accepted.id}`);
    expect(await store.get(waiting.id)).not.toBeNull();
  });
});

describe("lapse and purge", () => {
  it("waiting 30 days: lapsed; the text of a closed one wiped, then the row erased", async () => {
    const [old] = await sql<{ id: string }[]>`
      insert into liaison_demandes (origine, dossier, titre, description, cree_le)
      values ('directe', ${DOSSIER}, 'vieux', 'vieux', now() - interval '31 days') returning id`;
    const id = Number(old?.id);
    const open = await nouvelle();
    expect(await store.lapse(new Date())).toBeGreaterThanOrEqual(1);
    expect((await store.get(id))?.statut).toBe("caduque");

    const r1 = await store.purge(minutes(1), minutes(-60));
    expect(r1.textes).toBeGreaterThanOrEqual(1);
    expect(await store.get(id)).toMatchObject({ titre: null, description: null });
    const r2 = await store.purge(minutes(1), minutes(1));
    expect(r2.lignes).toBeGreaterThanOrEqual(1);
    expect(await store.get(id)).toBeNull();
    expect((await store.get(open.id))?.titre).toBe("Refaire la page");
  });
});

describe("the ceiling: 10 demands handed over in 24 hours", () => {
  it("the 11th claim is refused by the database, and the store says plafond", async () => {
    let refused: unknown = null;
    for (let i = 0; i < 12 && refused === null; i++) {
      const d = await acceptee();
      try {
        await store.claim(d.id, new Date());
      } catch (e) {
        refused = e;
      }
    }
    expect(refused).toMatchObject({ kind: "plafond" });
    expect(await store.takenSince(minutes(-24 * 60))).toBe(10);
  });

  afterAll(async () => {
    // Close what was taken, so that the ceiling does not weigh on the next files.
    const now = new Date();
    for (const d of await store.recent(1, 200)) {
      if (d.statut === "en_cours") await store.close(d.id, { categorie: "test" }, now);
      if (d.statut === "acceptee") await store.refuseUnclaimed(d.id, "test", now);
      if (d.statut === "attente") await store.refuse(d.id, now);
    }
    await sql`DELETE FROM liaison_demandes WHERE clos_le IS NOT NULL`;
  });
});
