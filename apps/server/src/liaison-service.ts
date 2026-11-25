/**
 * The « Maison » tab's service (ADR-0048, point 2): I type a demand to the
 * house, correct it, accept it — the page signs what it showed me, with its
 * key of the ADR-0013 — refuse it, or cancel it within 2 minutes. It shows
 * where my demands are, as the house last said: statuses, sub-tickets, links
 * of pull requests. The titles the house returns are written by its model:
 * sent to the page as data, shown as text, never followed.
 * The page never holds the house's key: the `liaison` program alone does.
 */
import { type LiaisonAcceptation, LiaisonTexteRefus, texteHash } from "@cenacle/core";
import {
  type Demande,
  LiaisonDemandeError,
  type LiaisonDemandes,
  type LiaisonEtats,
  type SousTicket,
} from "@cenacle/journal";

/** A refusal the page shows as is: what, never a value of the text. */
export class LiaisonPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiaisonPageError";
  }
}

export interface EtatMaison {
  readonly statut: string;
  /** Written by the house's model: data, shown as text. */
  readonly titre: string;
  readonly sousTickets: readonly SousTicket[];
  readonly pr: readonly string[];
}

export interface DemandeView {
  readonly id: number;
  readonly statut: Demande["statut"];
  readonly titre: string | null;
  readonly description: string | null;
  readonly dossier: string;
  readonly creeLe: string;
  readonly partirApres: string | null;
  readonly ticket: string | null;
  readonly categorie: string | null;
  readonly maison: EtatMaison | null;
}

export interface LiaisonView {
  /** liaison.toml: off, nothing leaves — said on the page, the form stays usable. */
  readonly actif: "actif" | "coupe" | "illisible";
  /** The folders a demand may aim at; empty with `config` when liaison.local.toml is wrong. */
  readonly dossiers: readonly string[];
  readonly config: string | null;
  readonly demandes: readonly DemandeView[];
  /** The last reading of `etat`: when, and how it went. */
  readonly lecture: { readonly le: string; readonly issue: string } | null;
}

export interface LiaisonServiceDeps {
  readonly demandes: LiaisonDemandes;
  readonly etats: Pick<LiaisonEtats, "all">;
  /** The page's signature (its private key, ADR-0013): the page's server alone holds it. */
  readonly sign: (a: LiaisonAcceptation) => string;
  /** liaison.toml, read again at each call. */
  readonly interrupteur: () => "actif" | "coupe" | "illisible";
  /** The folders of liaison.local.toml, read again at each call, or the kind of its error. */
  readonly dossiers: () => { readonly ok: readonly string[] } | { readonly probleme: string };
  readonly derniereLecture: () => Promise<{ le: Date; issue: string } | null>;
  readonly now: () => Date;
}

export interface LiaisonService {
  view(): Promise<LiaisonView>;
  create(body: Record<string, unknown>): Promise<number>;
  edit(id: number, body: Record<string, unknown>): Promise<void>;
  /** The text I was shown comes back: the page signs that one, or nothing. */
  accept(id: number, body: Record<string, unknown>): Promise<void>;
  refuse(id: number): Promise<void>;
  cancel(id: number): Promise<void>;
}

const iso = (d: Date | null) => (d === null ? null : d.toISOString());

/** A refusal of the code, said as is; anything else goes on (internal error). */
async function said<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof LiaisonTexteRefus) throw new LiaisonPageError(`refusée : ${e.message}`);
    if (e instanceof LiaisonDemandeError) throw new LiaisonPageError(e.message);
    throw e;
  }
}

export function createLiaisonService(deps: LiaisonServiceDeps): LiaisonService {
  const fields = (body: Record<string, unknown>) => {
    const { titre, description, dossier } = body;
    if (typeof titre !== "string" || typeof description !== "string") {
      throw new LiaisonPageError("un titre et une description sont attendus");
    }
    if (typeof dossier !== "string") throw new LiaisonPageError("un dossier est attendu");
    const d = deps.dossiers();
    if (!("ok" in d) || !d.ok.includes(dossier)) {
      throw new LiaisonPageError("ce dossier n'est pas déclaré dans liaison.local.toml");
    }
    return { titre, description, dossier };
  };

  return {
    async view() {
      const d = deps.dossiers();
      const etats = new Map((await deps.etats.all()).map((e) => [e.ticket, e]));
      const lecture = await deps.derniereLecture();
      return {
        actif: deps.interrupteur(),
        dossiers: "ok" in d ? d.ok : [],
        config: "ok" in d ? null : d.probleme,
        lecture: lecture === null ? null : { le: lecture.le.toISOString(), issue: lecture.issue },
        demandes: (await deps.demandes.recent(30, 100)).map((x) => {
          const e = x.ticket === null ? undefined : etats.get(x.ticket);
          return {
            id: x.id,
            statut: x.statut,
            titre: x.titre,
            description: x.description,
            dossier: x.dossier,
            creeLe: x.creeLe.toISOString(),
            partirApres: iso(x.partirApres),
            ticket: x.ticket,
            categorie: x.categorie,
            maison:
              e === undefined
                ? null
                : { statut: e.statut, titre: e.titre, sousTickets: e.sousTickets, pr: e.pr },
          };
        }),
      };
    },

    async create(body) {
      const f = fields(body);
      return said(async () => (await deps.demandes.create(f, f.dossier)).id);
    },

    async edit(id, body) {
      const f = fields(body);
      await said(() => deps.demandes.edit(id, f, f.dossier));
    },

    async accept(id, body) {
      const seen = fields(body);
      await said(async () => {
        const d = await deps.demandes.get(id);
        if (d === null) throw new LiaisonPageError(`demande ${id} inconnue`);
        // Exact, never normalised: what I saw is what gets signed, or nothing is.
        if (
          d.titre === null ||
          d.description === null ||
          d.titre !== seen.titre ||
          d.description !== seen.description ||
          d.dossier !== seen.dossier
        ) {
          throw new LiaisonPageError(`demande ${id} : le texte a changé, recharge la page`);
        }
        const decideLe = deps.now();
        const signature = deps.sign({
          id: d.id,
          origine: d.origine,
          dossier: d.dossier,
          titre: d.titre,
          description: d.description,
          decideLe,
        });
        // Signed on the text read just now; the database accepts only if it is still that text.
        await deps.demandes.accept(id, {
          texteHash: texteHash(d.titre, d.description),
          dossier: d.dossier,
          signature,
          decideLe,
        });
      });
    },

    async refuse(id) {
      await said(() => deps.demandes.refuse(id, deps.now()));
    },

    async cancel(id) {
      await said(() => deps.demandes.cancel(id, deps.now()));
    },
  };
}
