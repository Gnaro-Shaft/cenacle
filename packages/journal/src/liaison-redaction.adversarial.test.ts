// Drafting from a mail (ADR-0049), in the real database, with the
// application role: only the mails of the « travail » folder, arrived since
// the opening, not read yet; one mail, one draft, ever — even in direct SQL;
// the link to the mail never changes; a mail Iris forgets takes its drafts
// along: those still open lapse, and every text is wiped.
import { afterAll, describe, expect, it } from "vitest";
import { createLiaisonDemandes } from "./liaison-demandes.ts";
import { createLiaisonRedaction } from "./liaison-redaction.ts";
import { createLocationStore, VIRTUAL_UID_VALIDITY } from "./mail-locations.ts";
import { appConnection } from "./test-db.ts";

const sql = appConnection();
/** The mails written here, erased at the end: the test database is shared by every file. */
const written: number[] = [];
afterAll(async () => {
  if (written.length > 0) {
    // Erasing the mails drops their marks and lapses their drafts (trigger of 039).
    await sql`DELETE FROM mail_items WHERE uid_validity = ${VIRTUAL_UID_VALIDITY} AND uid IN ${sql(written)}`;
    await sql`DELETE FROM mail_locations WHERE id IN ${sql(written)}`;
    await sql`DELETE FROM liaison_demandes WHERE clos_le IS NOT NULL`;
  }
  await sql.end();
});
const store = createLiaisonRedaction(sql);
const demandes = createLiaisonDemandes(sql);
const locations = createLocationStore(sql);
const TRAVAIL = "a".repeat(64);
const AUTRE = "b".repeat(64);
const DOSSIER = "maison-etalon";
const OUVERTE = new Date("2031-01-01T00:00:00Z");
const at = (days: number) => new Date(OUVERTE.getTime() + days * 86_400_000);
let uid = 5000;

/** A mail Iris remembers, in a folder, arrived at `when`: nothing of its content. */
async function mailIn(folderKey: string, when: Date): Promise<number> {
  const id = await locations.add({ folderKey, uidValidity: "77", uid: ++uid }, null);
  await sql`insert into mail_items (mailbox, uid_validity, uid, at, category, decided_by)
            values ('inbox', ${VIRTUAL_UID_VALIDITY}, ${id}, ${when}, 'clients_prospects', 'model')`;
  written.push(id);
  return id;
}
const texte = { titre: "Refaire la page", description: "Avec des tests." };

describe("which mails are to draft", () => {
  it("in the folder, since the opening, not read, not drafted", async () => {
    const inside = await mailIn(TRAVAIL, at(1));
    const before = await mailIn(TRAVAIL, at(-1));
    const elsewhere = await mailIn(AUTRE, at(1));
    const read = await mailIn(TRAVAIL, at(2));
    await store.marquer(read, "plancher");
    const ids = await store.aRediger(TRAVAIL, OUVERTE, 50);
    expect(ids).toContain(inside);
    expect(ids).not.toContain(before);
    expect(ids).not.toContain(elsewhere);
    expect(ids).not.toContain(read);
    await store.brouillon(inside, texte, DOSSIER);
    expect(await store.aRediger(TRAVAIL, OUVERTE, 50)).not.toContain(inside);
  });

  it("a malformed folder key is refused, never a query", async () => {
    await expect(store.aRediger("'; drop table x; --", OUVERTE, 5)).rejects.toThrow();
  });
});

describe("one mail, one draft", () => {
  it("the draft is a waiting demand of origin mail, linked to its mail", async () => {
    const m = await mailIn(TRAVAIL, at(3));
    const id = await store.brouillon(m, texte, DOSSIER);
    expect(await demandes.get(id)).toMatchObject({
      origine: "mail",
      mailRef: m,
      statut: "attente",
      signature: null,
    });
  });

  it("a second draft of the same mail is refused, by the store and in direct SQL", async () => {
    const m = await mailIn(TRAVAIL, at(4));
    await store.brouillon(m, texte, DOSSIER);
    await expect(store.brouillon(m, texte, DOSSIER)).rejects.toBeDefined();
    await expect(
      sql`insert into liaison_demandes (origine, mail_ref, dossier, titre, description)
          values ('mail', ${m}, ${DOSSIER}, 't', 'd')`,
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("origin and link go together; the link never changes", async () => {
    await expect(
      sql`insert into liaison_demandes (origine, dossier, titre, description)
          values ('mail', ${DOSSIER}, 't', 'd')`,
    ).rejects.toBeDefined();
    await expect(
      sql`insert into liaison_demandes (origine, mail_ref, dossier, titre, description)
          values ('directe', 7, ${DOSSIER}, 't', 'd')`,
    ).rejects.toBeDefined();
    const m = await mailIn(TRAVAIL, at(5));
    const id = await store.brouillon(m, texte, DOSSIER);
    await expect(
      sql`update liaison_demandes set mail_ref = ${m + 1} where id = ${id}`,
    ).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("a third party's data in a draft is refused before the database", async () => {
    const m = await mailIn(TRAVAIL, at(6));
    await expect(
      store.brouillon(m, { titre: "t", description: "jean@exemple.org" }, DOSSIER),
    ).rejects.toBeDefined();
    expect(await store.aRediger(TRAVAIL, OUVERTE, 50)).toContain(m);
  });
});

describe("a mail forgotten takes its drafts along", () => {
  it("open drafts lapse, every text is wiped, the mark goes", async () => {
    const waiting = await mailIn(TRAVAIL, at(7));
    const refused = await mailIn(TRAVAIL, at(8));
    const a = await store.brouillon(waiting, texte, DOSSIER);
    const b = await store.brouillon(refused, texte, DOSSIER);
    await demandes.refuse(b, new Date());
    await sql`delete from mail_items where uid_validity = ${VIRTUAL_UID_VALIDITY} and uid in ${sql([waiting, refused])}`;
    expect(await demandes.get(a)).toMatchObject({
      statut: "caduque",
      titre: null,
      description: null,
    });
    expect(await demandes.get(b)).toMatchObject({
      statut: "refusee",
      titre: null,
      description: null,
    });
    const [lus] = await sql<{ n: number }[]>`
      select count(*)::int as n from liaison_mails_lus where mail_id in ${sql([waiting, refused])}`;
    expect(lus?.n).toBe(0);
  });

  it("a demand I typed is never touched by a mail's erasure", async () => {
    const d = await demandes.create(texte, DOSSIER);
    const m = await mailIn(TRAVAIL, at(9));
    await sql`delete from mail_items where uid_validity = ${VIRTUAL_UID_VALIDITY} and uid = ${m}`;
    expect(await demandes.get(d.id)).toMatchObject({ statut: "attente", titre: "Refaire la page" });
  });
});

describe("the counter", () => {
  it("drafts from mails still waiting", async () => {
    const before = await store.enAttente();
    await store.brouillon(await mailIn(TRAVAIL, at(10)), texte, DOSSIER);
    expect(await store.enAttente()).toBe(before + 1);
  });
});
