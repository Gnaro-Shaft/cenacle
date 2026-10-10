/**
 * The document a person receives when they ask what Iris holds on them
 * (GDPR art. 15 and 20). It speaks the words of the information notice, never
 * Iris's internal identifiers: their mail is "information sans réponse
 * attendue", not "bruit" — the notice promised those words, and the internal
 * one is pejorative to them. An identifier with no translation is refused
 * rather than handed over raw.
 */
import type { Category } from "@cenacle/core";
import type { DecidedBy, Holdings } from "@cenacle/journal";

/** The boxes, in the notice's words ("Ce qu'il lit, et ce qu'il garde"). */
export const BOX_LABEL: Readonly<Record<Category, string>> = {
  clients_prospects: "client ou prospect",
  administratif: "administratif",
  bruit: "information sans réponse attendue",
  a_trier: "à trier par moi",
};

/** Who put the mail in its box. Never why it was set aside. */
export const DECIDED_BY_LABEL: Readonly<Record<DecidedBy, string>> = {
  rule: "une règle",
  model: "le modèle local",
  unreadable: "mis de côté pour moi, sans le modèle",
  set_aside: "mis de côté pour moi, sans le modèle",
  unauthenticated: "mis de côté pour moi, sans le modèle",
};

export class ExportLabelError extends Error {
  constructor(what: string) {
    super(`${what} has no wording for the export`);
    this.name = "ExportLabelError";
  }
}

function label<K extends string>(table: Readonly<Record<K, string>>, value: string, what: string) {
  if (!Object.hasOwn(table, value)) throw new ExportLabelError(what);
  return table[value as K];
}

export function personExport(held: Holdings, now: Date) {
  return {
    exporte_le: now.toISOString(),
    responsable: "Gnaro (EURL)",
    ce_que_cenacle_detient: {
      ...held,
      received: held.received.map((m) => ({
        receivedAt: m.receivedAt,
        case: m.category === null ? "pas encore rangé" : label(BOX_LABEL, m.category, "a box"),
        rangePar: m.decidedBy === null ? null : label(DECIDED_BY_LABEL, m.decidedBy, "a sorter"),
      })),
    },
    ce_qui_n_est_pas_inclus: [
      "L'objet et le corps des mails : Cénacle ne les conserve jamais, il les relit dans la boîte quand il en a besoin.",
      "Votre adresse en clair : Cénacle ne garde qu'une clé dérivée (HMAC), d'où cette recherche.",
      "Les mails eux-mêmes : ils sont dans la boîte de messagerie, hors de Cénacle.",
    ],
  };
}
