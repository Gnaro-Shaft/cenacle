/**
 * What the house said of my demands at the last reading of `etat` (ADR-0048).
 * One row per ticket, replaced at each reading; a ticket the house no longer
 * reports (past its 30 days) is erased. The entries arrive already checked by
 * the liaison (apps/liaison) — the table checks their form once more.
 * Titles are written by the house's model: data, never instructions.
 */
import type { Sql } from "postgres";

export interface SousTicket {
  readonly ticket: string;
  readonly statut: string;
  readonly titre: string;
}

export interface EtatTicket {
  readonly ticket: string;
  readonly statut: string;
  readonly titre: string;
  readonly cree: Date;
  readonly sousTickets: readonly SousTicket[];
  readonly pr: readonly string[];
}

export interface EtatLu extends EtatTicket {
  readonly luLe: Date;
  /** The pull requests already announced on Telegram. */
  readonly prSignalees: readonly string[];
}

/** A pull request seen for the first time: to announce, once. */
export interface PrNouvelle {
  readonly ticket: string;
  readonly pr: string;
}

export interface LiaisonEtats {
  /**
   * The whole reading, in one transaction: each ticket upserted (what was
   * announced is kept), every other one erased. Returns the pull requests
   * not announced yet.
   */
  replace(etats: readonly EtatTicket[], luLe: Date): Promise<PrNouvelle[]>;
  /** Marks a pull request announced (announce, then confirm: at worst twice). */
  markAnnounced(ticket: string, pr: string): Promise<boolean>;
  all(): Promise<EtatLu[]>;
}

interface Row {
  ticket: string;
  statut: string;
  titre: string;
  cree: Date;
  sous_tickets: SousTicket[];
  pr: string[];
  pr_signalees: string[];
  lu_le: Date;
}

const fromRow = (r: Row): EtatLu => ({
  ticket: r.ticket,
  statut: r.statut,
  titre: r.titre,
  cree: r.cree,
  sousTickets: r.sous_tickets,
  pr: r.pr,
  prSignalees: r.pr_signalees,
  luLe: r.lu_le,
});

export function createLiaisonEtats(sql: Sql): LiaisonEtats {
  return {
    async replace(etats, luLe) {
      return sql.begin(async (tx) => {
        const nouvelles: PrNouvelle[] = [];
        for (const e of etats) {
          const sous = e.sousTickets.map((s) => ({
            ticket: s.ticket,
            statut: s.statut,
            titre: s.titre,
          }));
          const [row] = await tx<{ pr_signalees: string[] }[]>`
            insert into liaison_etats (ticket, statut, titre, cree, sous_tickets, pr, lu_le)
            values (${e.ticket}, ${e.statut}, ${e.titre}, ${e.cree}, ${tx.json(sous)},
                    ${[...e.pr]}, ${luLe})
            on conflict (ticket) do update set
              statut = excluded.statut, titre = excluded.titre, cree = excluded.cree,
              sous_tickets = excluded.sous_tickets, pr = excluded.pr, lu_le = excluded.lu_le
            returning pr_signalees`;
          const deja = new Set(row?.pr_signalees ?? []);
          for (const pr of e.pr) if (!deja.has(pr)) nouvelles.push({ ticket: e.ticket, pr });
        }
        const tickets = etats.map((e) => e.ticket);
        await tx`DELETE FROM liaison_etats WHERE ticket <> all(${tickets}::text[])`;
        return nouvelles;
      });
    },

    async markAnnounced(ticket, pr) {
      const result = await sql`
        update liaison_etats set pr_signalees = array_append(pr_signalees, ${pr})
        where ticket = ${ticket} and ${pr} = any(pr) and not (${pr} = any(pr_signalees))`;
      return result.count === 1;
    },

    async all() {
      const rows = await sql<Row[]>`select * from liaison_etats order by cree desc, ticket`;
      return rows.map(fromRow);
    },
  };
}
