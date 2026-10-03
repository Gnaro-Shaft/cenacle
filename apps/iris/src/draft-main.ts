/**
 * Iris drafts replies for the due follow-ups of the mailbox (phase 4, B2).
 * Each due mail without a decision goes to the vote once: a proposal waiting
 * for me, or a skip (split vote, no template). Nothing is ever sent here.
 * Usage: npm run iris:draft   (then npm run proposal -- list)
 */
import { randomBytes } from "node:crypto";
import {
  chooseTrame,
  createLocalModels,
  extractThreadSlots,
  localModelConfigFromEnv,
} from "@cenacle/brain";
import { followUpOf } from "@cenacle/core";
import {
  connectAsApp,
  createJournal,
  createMailStore,
  createProposalStore,
} from "@cenacle/journal";
import {
  createProposals,
  loadCadre,
  loadTrames,
  readMailsForModel,
  testMailboxConfigFromEnv,
} from "@cenacle/mail";
import { draftFollowUp } from "./draft.ts";

const LABEL = {
  split: "vote partagé",
  no_trame: "aucune trame ne convient",
  unsupported_fact: "fait non étayé",
};
const sql = connectAsApp();
try {
  const local = createLocalModels(localModelConfigFromEnv());
  const store = createProposalStore(sql);
  const proposals = createProposals(store, createJournal(sql));
  const mails = createMailStore(sql);
  const position = await mails.position("inbox");
  if (position === null)
    throw new Error("Iris ne connaît aucun mail : lance d'abord npm run mail:sort");
  const now = new Date();
  const sent = await mails.sent();
  const todo: number[] = [];
  for (const m of await mails.inbox()) {
    if (followUpOf(m, sent, now) !== "due") continue;
    if (!(await store.existsFor(position.uidValidity, m.uid))) todo.push(m.uid);
  }
  console.log(`${todo.length} relance(s) due(s) sans décision\n`);
  if (todo.length > 0) {
    const { mail } = loadCadre();
    const read = await readMailsForModel(
      mail,
      testMailboxConfigFromEnv().password,
      todo,
      position.uidValidity,
    );
    const deps = {
      trames: loadTrames(),
      proposals,
      vote: (m: Parameters<typeof chooseTrame>[0], o: Parameters<typeof chooseTrame>[1]) =>
        chooseTrame(m, o, { local }),
      copySlots: (
        m: Parameters<typeof extractThreadSlots>[0],
        s: Parameters<typeof extractThreadSlots>[1],
      ) => extractThreadSlots(m, s, { local }),
      newId: () => `p-${randomBytes(4).toString("hex")}`,
      now: () => new Date(),
    };
    // A due mail that is no longer on the server is said, never skipped silently.
    const gone = todo.length - read.length;
    if (gone > 0) {
      console.error(
        `⚠ ${gone} mail(s) dû(s) introuvable(s) sur le serveur — relance npm run mail:sort pour mettre Iris à jour`,
      );
      process.exitCode = 1;
    }
    let proposed = 0;
    for (const m of read) {
      const r = await draftFollowUp(m, position.uidValidity, deps);
      if (r.kind === "proposed") {
        proposed += 1;
        const left = r.toComplete.length > 0 ? ` — à compléter : ${r.toComplete.join(", ")}` : "";
        console.log(`✔ ${r.proposalId} « ${m.subject} » → ${r.trame}${left}`);
      } else
        console.log(`· « ${m.subject} » → rien proposé (${LABEL[r.reason]}) : à traiter toi-même`);
    }
    console.log(`\n${proposed} brouillon(s) à valider — npm run proposal -- list`);
  }
} catch (error) {
  console.error(`🛑 ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
