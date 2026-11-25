/**
 * The demands to the house (ADR-0048, T-12): typed by me (the page,
 * Telegram), accepted on the page alone (its signature), handed over by the
 * `liaison` program alone. The life cycle is the table's (038): this store
 * only asks, and the database refuses what does not hold — whatever role asks.
 * The text is checked here as the house checks it, before the database.
 */
import { DOSSIER_RULE, type TexteDemande, validerTexteDemande } from "@cenacle/core";
import type { Sql } from "postgres";

export const STATUTS_DEMANDE = [
  "attente",
  "acceptee",
  "refusee",
  "annulee",
  "caduque",
  "en_cours",
  "transmise",
  "echouee",
] as const;
export type StatutDemande = (typeof STATUTS_DEMANDE)[number];

/** 2 minutes to change my mind (the table holds it too). */
export const DELAI_ANNULATION_MS = 2 * 60_000;
/** An acceptance not handed over within 24 hours lapses (the table refuses the claim too). */
export const ACCEPTATION_MAX_MS = 24 * 3_600_000;
/** A demand waiting 30 days lapses. */
export const ATTENTE_MAX_MS = 30 * 24 * 3_600_000;
/** 10 demands handed over in 24 hours, at most (the table counts them too). */
export const PLAFOND_PAR_JOUR = 10;

export interface Demande {
  readonly id: number;
  readonly creeLe: Date;
  /** `mail`: drafted by the local model from a mail I filed (ADR-0049). */
  readonly origine: "directe" | "mail";
  /** Iris's fixed id of that mail; null for a demand I typed. */
  readonly mailRef: number | null;
  readonly dossier: string;
  /** Null once wiped, 30 days after the demand closed. */
  readonly titre: string | null;
  readonly description: string | null;
  readonly statut: StatutDemande;
  readonly decideLe: Date | null;
  readonly partirApres: Date | null;
  readonly prisLe: Date | null;
  readonly closLe: Date | null;
  readonly signature: string | null;
  readonly ticket: string | null;
  readonly categorie: string | null;
}

export type LiaisonDemandeErreur = "introuvable" | "etat" | "texte_change" | "dossier" | "plafond";

/** A demand that cannot do what was asked: what, never its text. */
export class LiaisonDemandeError extends Error {
  readonly kind: LiaisonDemandeErreur;
  constructor(kind: LiaisonDemandeErreur, message: string) {
    super(message);
    this.name = "LiaisonDemandeError";
    this.kind = kind;
  }
}

/** What the page signed: the hash of the text it showed, and the instant of my decision. */
export interface AcceptationSignee {
  readonly texteHash: string;
  readonly dossier: string;
  readonly signature: string;
  readonly decideLe: Date;
}

export type Issue = { readonly ticket: string } | { readonly categorie: string };

export interface LiaisonDemandes {
  /** A new demand, waiting; the text checked as the house checks it. */
  create(texte: TexteDemande, dossier: string): Promise<Demande>;
  get(id: number): Promise<Demande | null>;
  /** The open ones and those closed in the last `jours` days, newest first. */
  recent(jours: number, limit: number): Promise<Demande[]>;
  /** My edit of a waiting demand. */
  edit(id: number, texte: TexteDemande, dossier: string): Promise<Demande>;
  /** My acceptance, signed by the page; refused if the text is not the one signed. */
  accept(id: number, signee: AcceptationSignee): Promise<Demande>;
  refuse(id: number, now: Date): Promise<Demande>;
  /** Within the undo delay only. */
  cancel(id: number, now: Date): Promise<Demande>;
  /** Accepted, past the undo delay: the liaison's work, oldest first. */
  due(now: Date, limit: number): Promise<Demande[]>;
  /** Taken once: false when it is no longer accepted; "plafond" at the 11th in 24 h. */
  claim(id: number, now: Date): Promise<boolean>;
  /** An acceptance refused before being taken (unsigned, text, folder): failed. */
  refuseUnclaimed(id: number, categorie: string, now: Date): Promise<boolean>;
  /** The house's answer: handed over (a ticket) or failed (a category). */
  close(id: number, issue: Issue, now: Date): Promise<boolean>;
  /** Taken before `avant` and still open: a pass cut off between the claim and the close. */
  bloquees(avant: Date): Promise<Demande[]>;
  /** Taken in the last 24 hours (the ceiling). */
  takenSince(since: Date): Promise<number>;
  /** Handed over since then: whether `etat` is still worth reading. */
  transmisesDepuis(since: Date): Promise<number>;
  /** The demand that became this ticket, or null. */
  idDuTicket(ticket: string): Promise<number | null>;
  /** Waiting 30 days, or accepted 24 hours ago and never taken: lapsed. How many. */
  lapse(now: Date): Promise<number>;
  /** Wipes the text of demands closed before `texte`, erases those closed before `ligne`. */
  purge(texte: Date, ligne: Date): Promise<{ textes: number; lignes: number }>;
}

interface Row {
  id: string | number;
  cree_le: Date;
  origine: "directe" | "mail";
  mail_ref: string | number | null;
  dossier: string;
  titre: string | null;
  description: string | null;
  statut: StatutDemande;
  decide_le: Date | null;
  partir_apres: Date | null;
  pris_le: Date | null;
  clos_le: Date | null;
  signature: string | null;
  ticket: string | null;
  categorie: string | null;
}

const fromRow = (r: Row): Demande => ({
  id: Number(r.id),
  creeLe: r.cree_le,
  origine: r.origine,
  mailRef: r.mail_ref === null ? null : Number(r.mail_ref),
  dossier: r.dossier,
  titre: r.titre,
  description: r.description,
  statut: r.statut,
  decideLe: r.decide_le,
  partirApres: r.partir_apres,
  prisLe: r.pris_le,
  closLe: r.clos_le,
  signature: r.signature,
  ticket: r.ticket,
  categorie: r.categorie,
});

const limited = (n: number) => Math.max(1, Math.min(200, Math.floor(n)));
const validId = (id: number) => Number.isSafeInteger(id) && id > 0;

function dossierValide(dossier: string): string {
  if (typeof dossier !== "string" || !DOSSIER_RULE.test(dossier)) {
    throw new LiaisonDemandeError("dossier", "nom de dossier invalide");
  }
  return dossier;
}

const sqlCode = (e: unknown) => (e as { code?: string }).code;

export function createLiaisonDemandes(sql: Sql): LiaisonDemandes {
  const get = async (id: number): Promise<Demande | null> => {
    if (!validId(id)) return null;
    const [row] = await sql<Row[]>`select * from liaison_demandes where id = ${id}`;
    return row === undefined ? null : fromRow(row);
  };

  /** One row back, or why not: unknown, or in another state. */
  const one = async (rows: Row[], id: number, what: string): Promise<Demande> => {
    const [row] = rows;
    if (row !== undefined) return fromRow(row);
    const current = await get(id);
    if (current === null) throw new LiaisonDemandeError("introuvable", `demande ${id} inconnue`);
    throw new LiaisonDemandeError("etat", `demande ${id} (${current.statut}) : ${what} refusé`);
  };

  return {
    get,

    async create(texte, dossier) {
      const t = validerTexteDemande(texte);
      const [row] = await sql<Row[]>`
        insert into liaison_demandes (origine, dossier, titre, description)
        values ('directe', ${dossierValide(dossier)}, ${t.titre}, ${t.description})
        returning *`;
      if (row === undefined) throw new Error("the demand was not kept");
      return fromRow(row);
    },

    async recent(jours, limit) {
      const since = new Date(Date.now() - Math.max(1, Math.min(365, jours)) * 86_400_000);
      const rows = await sql<Row[]>`
        select * from liaison_demandes
        where clos_le is null or clos_le >= ${since}
        order by cree_le desc, id desc limit ${limited(limit)}`;
      return rows.map(fromRow);
    },

    async edit(id, texte, dossier) {
      const t = validerTexteDemande(texte);
      const d = dossierValide(dossier);
      if (!validId(id)) throw new LiaisonDemandeError("introuvable", "demande inconnue");
      return one(
        await sql<Row[]>`
          update liaison_demandes set titre = ${t.titre}, description = ${t.description},
                 dossier = ${d}
          where id = ${id} and statut = 'attente' returning *`,
        id,
        "corriger",
      );
    },

    async accept(id, s) {
      if (!validId(id)) throw new LiaisonDemandeError("introuvable", "demande inconnue");
      const partirApres = new Date(s.decideLe.getTime() + DELAI_ANNULATION_MS);
      const rows = await sql<Row[]>`
        update liaison_demandes set statut = 'acceptee', decide_le = ${s.decideLe},
               partir_apres = ${partirApres}, signature = ${s.signature}
        where id = ${id} and statut = 'attente' and dossier = ${s.dossier}
          and encode(sha256(convert_to(titre || E'\n' || description, 'UTF8')), 'hex')
              = ${s.texteHash}
        returning *`;
      if (rows.length === 0 && (await get(id))?.statut === "attente") {
        throw new LiaisonDemandeError("texte_change", `demande ${id} : le texte a changé`);
      }
      return one(rows, id, "accepter");
    },

    async refuse(id, now) {
      if (!validId(id)) throw new LiaisonDemandeError("introuvable", "demande inconnue");
      return one(
        await sql<Row[]>`
          update liaison_demandes set statut = 'refusee', decide_le = ${now}, clos_le = ${now}
          where id = ${id} and statut = 'attente' returning *`,
        id,
        "refuser",
      );
    },

    async cancel(id, now) {
      if (!validId(id)) throw new LiaisonDemandeError("introuvable", "demande inconnue");
      try {
        return await one(
          await sql<Row[]>`
            update liaison_demandes set statut = 'annulee', clos_le = ${now}
            where id = ${id} and statut = 'acceptee' and partir_apres > ${now} returning *`,
          id,
          "annuler",
        );
      } catch (e) {
        // The database's clock says the delay is over, even if ours did not.
        if (sqlCode(e) === "42501") {
          throw new LiaisonDemandeError("etat", `demande ${id} : délai d'annulation passé`);
        }
        throw e;
      }
    },

    async due(now, limit) {
      const rows = await sql<Row[]>`
        select * from liaison_demandes
        where statut = 'acceptee' and partir_apres <= ${now}
        order by partir_apres, id limit ${limited(limit)}`;
      return rows.map(fromRow);
    },

    async claim(id, now) {
      try {
        const result = await sql`
          update liaison_demandes set statut = 'en_cours', pris_le = ${now}
          where id = ${id} and statut = 'acceptee'`;
        return result.count === 1;
      } catch (e) {
        if (sqlCode(e) === "23514") {
          throw new LiaisonDemandeError("plafond", `${PLAFOND_PAR_JOUR} demandes en 24 heures`);
        }
        throw e;
      }
    },

    async refuseUnclaimed(id, categorie, now) {
      const result = await sql`
        update liaison_demandes set statut = 'echouee', categorie = ${categorie}, clos_le = ${now}
        where id = ${id} and statut = 'acceptee'`;
      return result.count === 1;
    },

    async close(id, issue, now) {
      const result =
        "ticket" in issue
          ? await sql`
              update liaison_demandes set statut = 'transmise', ticket = ${issue.ticket},
                     clos_le = ${now}
              where id = ${id} and statut = 'en_cours'`
          : await sql`
              update liaison_demandes set statut = 'echouee', categorie = ${issue.categorie},
                     clos_le = ${now}
              where id = ${id} and statut = 'en_cours'`;
      return result.count === 1;
    },

    async bloquees(avant) {
      const rows = await sql<Row[]>`
        select * from liaison_demandes
        where statut = 'en_cours' and pris_le < ${avant} order by pris_le, id`;
      return rows.map(fromRow);
    },

    async takenSince(since) {
      const [row] = await sql<{ n: number }[]>`
        select count(*)::int as n from liaison_demandes where pris_le > ${since}`;
      return row?.n ?? 0;
    },

    async transmisesDepuis(since) {
      const [row] = await sql<{ n: number }[]>`
        select count(*)::int as n from liaison_demandes
        where statut = 'transmise' and clos_le >= ${since}`;
      return row?.n ?? 0;
    },

    async idDuTicket(ticket) {
      const [row] = await sql<{ id: string }[]>`
        select id from liaison_demandes where ticket = ${ticket} order by id desc limit 1`;
      return row === undefined ? null : Number(row.id);
    },

    async lapse(now) {
      const attente = new Date(now.getTime() - ATTENTE_MAX_MS);
      const acceptee = new Date(now.getTime() - ACCEPTATION_MAX_MS);
      const result = await sql`
        update liaison_demandes
        set statut = 'caduque', clos_le = ${now}, decide_le = coalesce(decide_le, ${now})
        where (statut = 'attente' and cree_le < ${attente})
           or (statut = 'acceptee' and decide_le < ${acceptee})`;
      return result.count;
    },

    async purge(texte, ligne) {
      const wiped = await sql`
        update liaison_demandes set titre = null, description = null
        where clos_le < ${texte} and titre is not null`;
      const erased = await sql`DELETE FROM liaison_demandes WHERE clos_le < ${ligne}`;
      return { textes: wiped.count, lignes: erased.count };
    },
  };
}
