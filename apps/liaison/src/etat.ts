/**
 * Reading where my demands are (ADR-0048, points 6 and 7): `etat`, every
 * 5 minutes while a demand handed over in the last 30 days may still move.
 * What comes back is checked (reponse.ts) and replaces the last reading. A
 * pull request seen for the first time is announced on Telegram — its ticket,
 * the demand's number and the link, never a title (written by a model, and it
 * may quote my demand) — then marked announced: at worst twice, never lost.
 * A failed reading is journaled; the page then says how old the last one is.
 */
import type { LiaisonEtats } from "@cenacle/journal";
import { AGENT, type JournalLiaison } from "./depot.ts";
import { lireEtat } from "./reponse.ts";
import type { Appel } from "./ssh.ts";

export const ETAT_INTERVALLE_MS = 5 * 60_000;

export interface EtatDeps {
  readonly etats: Pick<LiaisonEtats, "replace" | "markAnnounced">;
  /** `ssh liaison@<the VM> etat`. */
  readonly lire: () => Promise<Appel>;
  /** Whether a reading is due: something may still move, and the last reading is old enough. */
  readonly aLire: () => Promise<boolean>;
  /** The demand behind a ticket, for the message; null when unknown here. */
  readonly demandeDu: (ticket: string) => Promise<number | null>;
  readonly journal: JournalLiaison;
  readonly send: (text: string) => Promise<void>;
  readonly now: () => Date;
}

export type EtatIssue =
  | { readonly lu: false }
  | { readonly lu: true; readonly ok: false; readonly categorie: string }
  | { readonly lu: true; readonly ok: true; readonly demandes: number; readonly annoncees: number };

export function messagePr(ticket: string, demande: number | null, pr: string): string {
  const n = demande === null ? "" : ` (demande n° ${demande})`;
  return `🔀 Maison : une PR attend ta relecture — ${ticket}${n} : ${pr}`;
}

export async function relever(deps: EtatDeps): Promise<EtatIssue> {
  if (!(await deps.aLire())) return { lu: false };
  const appel = await deps.lire();
  const r = lireEtat(appel.code, appel.out);
  if (!r.ok) {
    await deps.journal.append({
      agent: AGENT,
      type: "liaison.etat",
      payload: { issue: "echec", categorie: r.categorie },
    });
    return { lu: true, ok: false, categorie: r.categorie };
  }
  const nouvelles = await deps.etats.replace(r.etats, deps.now());
  let annoncees = 0;
  for (const n of nouvelles) {
    try {
      await deps.send(messagePr(n.ticket, await deps.demandeDu(n.ticket), n.pr));
    } catch {
      // Not announced: said again at the next reading, since it stays unmarked.
      console.error("⚠️ Liaison : Telegram injoignable, PR à annoncer plus tard.");
      continue;
    }
    if (await deps.etats.markAnnounced(n.ticket, n.pr)) annoncees++;
  }
  await deps.journal.append({
    agent: AGENT,
    type: "liaison.etat",
    payload: { issue: "lu", demandes: r.etats.length, ecartes: r.ecartes, prs: annoncees },
  });
  return { lu: true, ok: true, demandes: r.etats.length, annoncees };
}
