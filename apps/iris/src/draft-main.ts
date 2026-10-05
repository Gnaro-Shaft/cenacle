/**
 * Iris drafts replies for the due follow-ups of the mailbox (phase 4, B2).
 * Each due mail without a decision goes to the vote once: a proposal waiting
 * for me, or a skip (split vote, no template). Nothing is ever sent here.
 * The daemon (npm run iris) does the same after each collection.
 * Usage: npm run iris:draft   (then npm run proposal -- list)
 */
import { createLocalModels, localModelConfigFromEnv } from "@cenacle/brain";
import { refuseForeignSecrets } from "@cenacle/core";
import {
  connectAsApp,
  createJournal,
  createMailStore,
  createProposalStore,
} from "@cenacle/journal";
import { loadCadre, mailPassword } from "@cenacle/mail";
import { draftDueFollowUps } from "./draft-due.ts";
import { draftingDeps } from "./drafting.ts";

const LABEL = {
  split: "vote partagé",
  no_trame: "aucune trame ne convient",
  unsupported_fact: "fait non étayé",
  set_aside: "écarté du modèle, à toi de répondre",
  unauthenticated: "expéditeur non authentifié, à toi de répondre",
};
// Iris can never accept: she must not even hold the page's key (ADR-0013).
refuseForeignSecrets("Iris", ["mail"]);
const sql = connectAsApp();
try {
  const r = await draftDueFollowUps(
    draftingDeps({
      local: createLocalModels(localModelConfigFromEnv()),
      journal: createJournal(sql),
      mails: createMailStore(sql),
      store: createProposalStore(sql),
      cadre: loadCadre().mail,
      password: mailPassword(loadCadre()),
    }),
  );
  if (r.lapsed > 0) {
    console.log(`🗑 ${r.lapsed} brouillon(s) caduc(s) : leur mail n'est plus sur le serveur`);
  }
  console.log(`${r.due} relance(s) due(s) sans décision\n`);
  if (r.gone > 0) {
    console.error(
      `⚠ ${r.gone} mail(s) dû(s) introuvable(s) sur le serveur — relance npm run mail:sort pour mettre Iris à jour`,
    );
    process.exitCode = 1;
  }
  let proposed = 0;
  for (const { mail, outcome } of r.outcomes) {
    if (outcome.kind === "proposed") {
      proposed += 1;
      const left =
        outcome.toComplete.length > 0 ? ` — à compléter : ${outcome.toComplete.join(", ")}` : "";
      console.log(`✔ ${outcome.proposalId} « ${mail.subject} » → ${outcome.trame}${left}`);
    } else {
      console.log(
        `· « ${mail.subject} » → rien proposé (${LABEL[outcome.reason]}) : à traiter toi-même`,
      );
    }
  }
  console.log(`\n${proposed} brouillon(s) à valider — npm run proposal -- list`);
} catch (error) {
  console.error(`🛑 ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
