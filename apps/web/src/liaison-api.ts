/** Calls of the « Maison » tab (ADR-0048), with the token of this run of the server. */
import { call } from "./api.ts";

export type StatutDemande =
  | "attente"
  | "acceptee"
  | "refusee"
  | "annulee"
  | "caduque"
  | "en_cours"
  | "transmise"
  | "echouee";

export interface SousTicketView {
  readonly ticket: string;
  readonly statut: string;
  /** Written by the house's model: data, shown as text. */
  readonly titre: string;
}

export interface DemandeView {
  readonly id: number;
  readonly statut: StatutDemande;
  /** `mail`: drafted by the local model from a mail I filed (ADR-0049). */
  readonly origine: "directe" | "mail";
  readonly titre: string | null;
  readonly description: string | null;
  readonly dossier: string;
  readonly creeLe: string;
  readonly partirApres: string | null;
  readonly ticket: string | null;
  readonly categorie: string | null;
  readonly maison: {
    readonly statut: string;
    readonly titre: string;
    readonly sousTickets: readonly SousTicketView[];
    readonly pr: readonly string[];
  } | null;
}

export interface LiaisonView {
  readonly actif: "actif" | "coupe" | "illisible";
  readonly dossiers: readonly string[];
  readonly config: string | null;
  readonly demandes: readonly DemandeView[];
  readonly lecture: { readonly le: string; readonly issue: string } | null;
}

export interface TexteDemande {
  readonly titre: string;
  readonly description: string;
  readonly dossier: string;
}

export const getLiaison = (token: string) => call<LiaisonView>(token, "/api/liaison");

export const creerDemande = (token: string, t: TexteDemande) =>
  call<{ id: number }>(token, "/api/liaison/demandes", {
    method: "POST",
    body: JSON.stringify(t),
  });

export const corrigerDemande = (token: string, id: number, t: TexteDemande) =>
  call(token, `/api/liaison/demandes/${id}`, { method: "PUT", body: JSON.stringify(t) });

/** Accepting carries the text I was shown: the server signs that one, or nothing. */
export const accepterDemande = (token: string, id: number, t: TexteDemande) =>
  call(token, `/api/liaison/demandes/${id}/accepter`, {
    method: "POST",
    body: JSON.stringify(t),
  });

export const agirDemande = (token: string, id: number, action: "refuser" | "annuler") =>
  call(token, `/api/liaison/demandes/${id}/${action}`, { method: "POST", body: "{}" });
