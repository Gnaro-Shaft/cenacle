/** Wires the drafting to the real model, mailbox and database (B3). */
import { randomBytes } from "node:crypto";
import { chooseTrame, extractThreadSlots, type LocalModels } from "@cenacle/brain";
import type { Journal, LocationStore, MailStore, ProposalStore } from "@cenacle/journal";
import {
  createLocator,
  createProposals,
  type Keyer,
  loadTrames,
  type MailCadre,
  readMailsForModelAt,
  refuseDrafts,
  senderAuthFor,
  storedVerdict,
} from "@cenacle/mail";
import type { DraftDueDeps } from "./draft-due.ts";

export function draftingDeps(w: {
  readonly local: LocalModels;
  readonly journal: Journal;
  readonly mails: MailStore;
  readonly store: ProposalStore;
  readonly cadre: MailCadre;
  readonly password: string;
  readonly keyer: Keyer;
  readonly locations: LocationStore;
}): DraftDueDeps {
  // M2: a real box is not drafted for until [ouverture] brouillons (M3).
  refuseDrafts(w.cadre, "Drafting replies");
  return {
    authenticated: senderAuthFor(w.cadre, storedVerdict(w.mails)),
    mails: w.mails,
    store: w.store,
    // ADR-0016: a mail is read where it is now, whatever folder I filed it in.
    read: (uids, uidValidity) =>
      readMailsForModelAt(
        createLocator({
          cadre: w.cadre,
          password: w.password,
          keyer: w.keyer,
          locations: w.locations,
        }),
        w.cadre,
        w.password,
        uids,
        uidValidity,
      ),
    trames: loadTrames(),
    proposals: createProposals(w.store, w.journal),
    vote: (m, o) => chooseTrame(m, o, { local: w.local }),
    copySlots: (m, s) => extractThreadSlots(m, s, { local: w.local }),
    newId: () => `p-${randomBytes(4).toString("hex")}`,
    now: () => new Date(),
  };
}
