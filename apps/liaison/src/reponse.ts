/**
 * What the house answers (ADR-0048, its docs/liaison.md): one JSON line on
 * the standard output, never believed (charter, rule 5). A ticket number, a
 * status, a date must have their fixed form; a category must be one of the
 * contract's closed list; a link, the exact form of a pull request on GitHub.
 * Titles are written by the house's model: data, never instructions —
 * stripped of every control character and cut at 120 characters, never
 * followed. A ticket that does not pass is left out and counted, never repaired.
 * The house's reason for a refusal is never kept: its category alone.
 */
import type { EtatTicket, SousTicket } from "@cenacle/journal";

/** The contract's categories (docs/liaison.md), plus the forced command's own (`magasin`). */
export const CATEGORIES_MAISON: ReadonlySet<string> = new Set([
  "appelant",
  "format",
  "taille",
  "controle",
  "courriel",
  "telephone",
  "iban",
  "lien",
  "numero",
  "dossier",
  "plafond",
  "politique",
  "paperclip",
  "cle",
  "journal",
  "magasin",
]);

export const TICKET_RULE = /^[A-Z][A-Z0-9]{0,9}-[0-9]{1,9}$/;
const STATUT_RULE = /^[a-z_]{1,20}$/;
const PR_RULE =
  /^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}\/pull\/[0-9]{1,7}$/;
const TITRE_MAX = 120;
const MAX_SOUS_TICKETS = 50;
const MAX_PR = 20;
const MAX_DEMANDES = 500;
/** An answer to `deposer` is one short line; `etat` may be long (the house's own cap: 8 MiB). */
export const MAX_DEPOT = 64 * 1024;
export const MAX_ETAT = 8 * 1024 * 1024;

/**
 * A refusal's category: the house's (its closed list), or ours —
 * `transport`: cut off, or ssh failed on the way: the demand may have been
 *   deposited — state unknown, never retried;
 * - `ssh`: ssh could not even start: nothing left the Mac;
 * - `reponse`: an answer that does not have the contract's form.
 */
export type ReponseDepot =
  | { readonly ok: true; readonly ticket: string }
  | { readonly ok: false; readonly categorie: string };

/** Exactly one non-empty line, ending with a line break, within `max` characters. */
function oneLine(out: string, max: number): unknown {
  if (out.length > max || !out.endsWith("\n")) return undefined;
  const line = out.slice(0, -1);
  if (line.includes("\n") || line.trim() === "") return undefined;
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Exit codes: 0, 1, 2 (the command's), 255 (ssh's), -1 (cut off), -2 (ssh did not start). */
function transport(code: number): { readonly ok: false; readonly categorie: string } | null {
  if (code === -2) return { ok: false, categorie: "ssh" };
  if (code === -1 || code === 255) return { ok: false, categorie: "transport" };
  return null;
}

/** The answer to `deposer`. */
export function lireDepot(code: number, out: string): ReponseDepot {
  const t = transport(code);
  if (t !== null) return t;
  const r = oneLine(out, MAX_DEPOT);
  if (!isObject(r)) return { ok: false, categorie: "reponse" };
  if (code === 0 && r.ok === true && typeof r.ticket === "string" && TICKET_RULE.test(r.ticket)) {
    return { ok: true, ticket: r.ticket };
  }
  if ((code === 1 || code === 2) && r.ok === false && typeof r.categorie === "string") {
    return {
      ok: false,
      categorie: CATEGORIES_MAISON.has(r.categorie) ? r.categorie : "reponse",
    };
  }
  return { ok: false, categorie: "reponse" };
}

/** A text of the house's model, made safe to keep and show: no control character, 120 at most. */
export function titrePropre(v: unknown): string {
  if (typeof v !== "string") return "";
  return [...v.replace(/\p{C}/gu, "")].slice(0, TITRE_MAX).join("");
}

export type ReponseEtat =
  | { readonly ok: true; readonly etats: EtatTicket[]; readonly ecartes: number }
  | { readonly ok: false; readonly categorie: string };

function sousTicket(v: unknown): SousTicket | null {
  if (!isObject(v)) return null;
  const { ticket, statut } = v;
  if (typeof ticket !== "string" || !TICKET_RULE.test(ticket)) return null;
  if (typeof statut !== "string" || !STATUT_RULE.test(statut)) return null;
  return { ticket, statut, titre: titrePropre(v.titre) };
}

function demande(v: unknown, compte: { ecartes: number }): EtatTicket | null {
  if (!isObject(v)) return null;
  const { ticket, statut, cree } = v;
  if (typeof ticket !== "string" || !TICKET_RULE.test(ticket)) return null;
  if (typeof statut !== "string" || !STATUT_RULE.test(statut)) return null;
  if (typeof cree !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(cree)) return null;
  const date = new Date(cree);
  if (Number.isNaN(date.getTime())) return null;
  const sous: SousTicket[] = [];
  for (const s of Array.isArray(v.sous_tickets) ? v.sous_tickets : []) {
    const ok = sous.length < MAX_SOUS_TICKETS ? sousTicket(s) : null;
    if (ok === null) compte.ecartes++;
    else sous.push(ok);
  }
  const pr: string[] = [];
  for (const p of Array.isArray(v.pr) ? v.pr : []) {
    if (typeof p === "string" && PR_RULE.test(p) && pr.length < MAX_PR && !pr.includes(p)) {
      pr.push(p);
    } else compte.ecartes++;
  }
  return { ticket, statut, titre: titrePropre(v.titre), cree: date, sousTickets: sous, pr };
}

/** The answer to `etat`: the tickets that pass, and how many pieces were left out. */
export function lireEtat(code: number, out: string): ReponseEtat {
  const t = transport(code);
  if (t !== null) return t;
  const r = oneLine(out, MAX_ETAT);
  if (!isObject(r)) return { ok: false, categorie: "reponse" };
  if (code !== 0 || r.ok !== true || !Array.isArray(r.demandes)) {
    const categorie =
      r.ok === false && typeof r.categorie === "string" && CATEGORIES_MAISON.has(r.categorie)
        ? r.categorie
        : "reponse";
    return { ok: false, categorie };
  }
  const compte = { ecartes: 0 };
  const etats: EtatTicket[] = [];
  for (const d of r.demandes) {
    const e = etats.length < MAX_DEMANDES ? demande(d, compte) : null;
    if (e === null || etats.some((x) => x.ticket === e.ticket)) compte.ecartes++;
    else etats.push(e);
  }
  return { ok: true, etats, ecartes: compte.ecartes };
}
