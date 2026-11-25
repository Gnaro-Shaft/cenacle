/**
 * The drafting program's store (ADR-0049, L3): which mails I filed in the
 * « travail » folder are still to read, and what came of each one. A draft and
 * its mark are written together: one mail, one draft at most (the table's
 * unique index holds it too). Folders are compared by their HMAC key, never by
 * name (ADR-0016); a mail arrived before the opening is never named here.
 */
import { DOSSIER_RULE, type TexteDemande, validerTexteDemande } from "@cenacle/core";
import type { Sql } from "postgres";
import { VIRTUAL_UID_VALIDITY } from "./mail-locations.ts";

/** What came of a mail read without a draft; a filter's category is one too. */
const ISSUE_RULE = /^[a-z_]{1,20}$/;
const FOLDER_KEY_RULE = /^[0-9a-f]{64}$/;

export interface LiaisonRedaction {
  /** Iris's ids of the mails in that folder, arrived since `depuis`, not read yet, oldest first. */
  aRediger(folderKey: string, depuis: Date, limit: number): Promise<number[]>;
  /** The draft, waiting, and the mark, in one transaction. Returns the demand's number. */
  brouillon(mailId: number, texte: TexteDemande, dossier: string): Promise<number>;
  /** A mail read without a draft, and why. */
  marquer(mailId: number, issue: string): Promise<void>;
  /** How many drafts from mails wait for me (Telegram's counter). */
  enAttente(): Promise<number>;
}

const validId = (id: number) => Number.isSafeInteger(id) && id > 0;

export function createLiaisonRedaction(sql: Sql): LiaisonRedaction {
  return {
    async aRediger(folderKey, depuis, limit) {
      if (!FOLDER_KEY_RULE.test(folderKey)) throw new Error("invalid folder key");
      const rows = await sql<{ id: string }[]>`
        select l.id from mail_locations l
        join mail_items m
          on m.mailbox = 'inbox' and m.uid_validity = ${VIRTUAL_UID_VALIDITY} and m.uid = l.id
        where l.folder_key = ${folderKey} and m.at >= ${depuis}
          and not exists (select 1 from liaison_mails_lus r where r.mail_id = l.id)
          and not exists (select 1 from liaison_demandes d where d.mail_ref = l.id)
        order by m.at, l.id
        limit ${Math.max(1, Math.min(50, Math.floor(limit)))}`;
      return rows.map((r) => Number(r.id));
    },

    async brouillon(mailId, texte, dossier) {
      if (!validId(mailId)) throw new Error("invalid mail id");
      const t = validerTexteDemande(texte);
      if (!DOSSIER_RULE.test(dossier)) throw new Error("invalid folder name");
      return sql.begin(async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          insert into liaison_demandes (origine, mail_ref, dossier, titre, description)
          values ('mail', ${mailId}, ${dossier}, ${t.titre}, ${t.description})
          returning id`;
        await tx`insert into liaison_mails_lus (mail_id, issue) values (${mailId}, 'brouillon')`;
        if (row === undefined) throw new Error("the draft was not kept");
        return Number(row.id);
      });
    },

    async marquer(mailId, issue) {
      if (!validId(mailId)) throw new Error("invalid mail id");
      if (!ISSUE_RULE.test(issue)) throw new Error("invalid issue");
      await sql`
        insert into liaison_mails_lus (mail_id, issue) values (${mailId}, ${issue})
        on conflict (mail_id) do nothing`;
    },

    async enAttente() {
      const [row] = await sql<{ n: number }[]>`
        select count(*)::int as n from liaison_demandes
        where origine = 'mail' and statut = 'attente'`;
      return row?.n ?? 0;
    },
  };
}
