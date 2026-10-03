/** Wires the drafting to the real model, mailbox and database (B3). */
import { randomBytes } from "node:crypto";
import { chooseTrame, extractThreadSlots, type LocalModels } from "@cenacle/brain";
import type { Journal, MailStore, ProposalStore } from "@cenacle/journal";
import { createProposals, loadTrames, type MailCadre, readMailsForModel } from "@cenacle/mail";
import type { DraftDueDeps } from "./draft-due.ts";

export function draftingDeps(w: {
  readonly local: LocalModels;
  readonly journal: Journal;
  readonly mails: MailStore;
  readonly store: ProposalStore;
  readonly cadre: MailCadre;
  readonly password: string;
}): DraftDueDeps {
  return {
    mails: w.mails,
    store: w.store,
    read: (uids, uidValidity) => readMailsForModel(w.cadre, w.password, uids, uidValidity),
    trames: loadTrames(),
    proposals: createProposals(w.store, w.journal),
    vote: (m, o) => chooseTrame(m, o, { local: w.local }),
    copySlots: (m, s) => extractThreadSlots(m, s, { local: w.local }),
    newId: () => `p-${randomBytes(4).toString("hex")}`,
    now: () => new Date(),
  };
}
