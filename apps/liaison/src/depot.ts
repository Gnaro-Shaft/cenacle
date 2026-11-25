/**
 * Handing my accepted demands over to the house (ADR-0048, point 5): once,
 * never guessed. Before anything leaves, everything is checked again (charter,
 * rule 5): the page's signature of this demand and this text, the filter, the
 * folder still declared; a refusal there never takes a claim, so it never uses
 * up the ceiling. Then the demand is taken, sent, and closed by the house's
 * answer — or, when the line was cut on the way, failed as "state unknown",
 * never sent again by itself. No model anywhere: a program without AI.
 */
import { LiaisonTexteRefus, validerTexteDemande } from "@cenacle/core";
import { type Demande, LiaisonDemandeError, type LiaisonDemandes } from "@cenacle/journal";
import { lireDepot } from "./reponse.ts";
import type { Appel } from "./ssh.ts";

export const AGENT = "liaison";
/** A demand taken this long ago and still open: its pass was cut off — state unknown. */
export const BLOQUEE_MS = 15 * 60_000;

/** The journal: facts only — numbers, sizes, states, categories, never a text. */
export interface JournalLiaison {
  append(event: {
    agent: string;
    type: string;
    payload: Record<string, string | number | boolean>;
  }): Promise<unknown>;
}

export interface DepotDeps {
  readonly demandes: Pick<
    LiaisonDemandes,
    "due" | "claim" | "refuseUnclaimed" | "close" | "lapse" | "bloquees"
  >;
  /** The page's signature of this demand, this text, this instant (liaison-signature.ts). */
  readonly signee: (d: Demande) => boolean;
  readonly dossiers: readonly string[];
  /** `ssh liaison@<the VM> deposer`, the demand on the standard input. */
  readonly deposer: (json: string) => Promise<Appel>;
  readonly journal: JournalLiaison;
  /** Telegram, to me alone; a failure there never undoes what was done. */
  readonly send: (text: string) => Promise<void>;
  /** When the ceiling was last said (journal), so that it is said once an hour at most. */
  readonly plafondDitLe: () => Promise<Date | null>;
  readonly now: () => Date;
}

export interface DepotBilan {
  transmises: number;
  echouees: number;
  refusees: number;
  caduques: number;
}

const RAPPEL = "Rappel : ni nom de client ni contenu de mail dans une demande.";

/** What I am told of a failed demand: its number and the category, never its text. */
export function messageEchec(id: number, categorie: string): string {
  if (categorie === "transport") {
    return (
      `⚠️ Demande n° ${id} : la liaison a été coupée en route. Elle a peut-être été déposée : ` +
      "regarde l'état de la maison sur la page avant de la refaire. Rien n'est relancé."
    );
  }
  if (categorie === "ssh") return `⚠️ Demande n° ${id} : ssh n'a pas démarré, rien n'est parti.`;
  if (categorie === "reponse") {
    return `⚠️ Demande n° ${id} : réponse de la maison illisible, état inconnu. Rien n'est relancé.`;
  }
  return `⛔ Demande n° ${id} refusée par la maison (${categorie}). Rien n'a été créé.`;
}

export function messageRefusLocal(id: number, categorie: string): string {
  if (categorie === "non_signee") {
    return `⛔ Demande n° ${id} : acceptation non signée par la page. Rien n'est parti.`;
  }
  if (categorie === "dossier") {
    return `⛔ Demande n° ${id} : son dossier n'est plus déclaré. Rien n'est parti.`;
  }
  return `⛔ Demande n° ${id} refusée avant l'envoi (${categorie}). Rien n'est parti. ${RAPPEL}`;
}

async function tell(deps: DepotDeps, text: string): Promise<void> {
  try {
    await deps.send(text);
  } catch {
    // Telegram away: the page shows the state; never the text in the console.
    console.error("⚠️ Liaison : Telegram injoignable, message non envoyé.");
  }
}

/** Why a demand may not leave, checked before any claim; null when it may. */
function refusLocal(deps: DepotDeps, d: Demande): string | null {
  if (d.titre === null || d.description === null) return "texte";
  if (!deps.signee(d)) return "non_signee";
  if (!deps.dossiers.includes(d.dossier)) return "dossier";
  try {
    const t = validerTexteDemande({ titre: d.titre, description: d.description });
    // The text that leaves is the text signed, to the character.
    if (t.titre !== d.titre || t.description !== d.description) return "controle";
  } catch (e) {
    if (e instanceof LiaisonTexteRefus) return e.categorie;
    throw e;
  }
  return null;
}

async function fermer(deps: DepotDeps, bilan: DepotBilan, d: Demande, appel: Appel) {
  const r = lireDepot(appel.code, appel.out);
  const taille = [...(d.titre ?? "")].length + [...(d.description ?? "")].length;
  if (r.ok) {
    await deps.demandes.close(d.id, { ticket: r.ticket }, deps.now());
    bilan.transmises++;
    await deps.journal.append({
      agent: AGENT,
      type: "liaison.depot",
      payload: { demande: d.id, issue: "transmise", ticket: r.ticket, taille },
    });
    await tell(deps, `✅ Demande n° ${d.id} transmise à la maison : ${r.ticket}.`);
    return;
  }
  await deps.demandes.close(d.id, { categorie: r.categorie }, deps.now());
  bilan.echouees++;
  await deps.journal.append({
    agent: AGENT,
    type: "liaison.depot",
    payload: { demande: d.id, issue: "echouee", categorie: r.categorie, taille },
  });
  await tell(deps, messageEchec(d.id, r.categorie));
}

export async function transmettre(deps: DepotDeps): Promise<DepotBilan> {
  const bilan: DepotBilan = { transmises: 0, echouees: 0, refusees: 0, caduques: 0 };
  // A pass cut off between the claim and the close: state unknown, never sent again.
  const avant = new Date(deps.now().getTime() - BLOQUEE_MS);
  for (const d of await deps.demandes.bloquees(avant)) {
    await fermer(deps, bilan, d, { code: -1, out: "" });
  }
  bilan.caduques = await deps.demandes.lapse(deps.now());
  if (bilan.caduques > 0) {
    await deps.journal.append({
      agent: AGENT,
      type: "liaison.caduques",
      payload: { n: bilan.caduques },
    });
  }
  for (const d of await deps.demandes.due(deps.now(), 10)) {
    const refus = refusLocal(deps, d);
    if (refus !== null) {
      if (await deps.demandes.refuseUnclaimed(d.id, refus, deps.now())) {
        bilan.refusees++;
        await deps.journal.append({
          agent: AGENT,
          type: "liaison.depot",
          payload: { demande: d.id, issue: "refusee", categorie: refus },
        });
        await tell(deps, messageRefusLocal(d.id, refus));
      }
      continue;
    }
    try {
      if (!(await deps.demandes.claim(d.id, deps.now()))) continue;
    } catch (e) {
      if (e instanceof LiaisonDemandeError && e.kind === "plafond") {
        const dit = await deps.plafondDitLe();
        if (dit === null || deps.now().getTime() - dit.getTime() > 3_600_000) {
          await deps.journal.append({ agent: AGENT, type: "liaison.plafond", payload: {} });
          await tell(
            deps,
            "⏸ Liaison : 10 demandes transmises en 24 heures. Les suivantes attendent, " +
              "et deviennent caduques 24 heures après leur acceptation.",
          );
        }
        break;
      }
      throw e;
    }
    const json = JSON.stringify({
      titre: d.titre,
      description: d.description,
      origine: d.origine,
      dossier: d.dossier,
    });
    await fermer(deps, bilan, d, await deps.deposer(json));
  }
  return bilan;
}
