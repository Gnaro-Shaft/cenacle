/**
 * Proposals by hand (phase 4, B1). From B2 on, Iris proposes by herself.
 * Usage: npm run proposal -- create | list | edit <id> "<texte>" | accept <id> | refuse <id> | cancel <id>
 * `create` drafts an acknowledgement for the first due follow-up without a proposal.
 * Nothing is ever sent here: only the executor sends (npm run executor).
 */
import { randomBytes } from "node:crypto";
import { checkDraft, followUpOf } from "@cenacle/core";
import {
  connectAsApp,
  createJournal,
  createMailStore,
  createProposalStore,
} from "@cenacle/journal";
import {
  createProposals,
  firstName,
  loadCadre,
  loadTrames,
  readMailsForModel,
  renderTrame,
  testMailboxConfigFromEnv,
} from "@cenacle/mail";

const [command, id, text] = process.argv.slice(2);
const sql = connectAsApp();
const store = createProposalStore(sql);
const proposals = createProposals(store, createJournal(sql));
const now = new Date();

try {
  switch (command) {
    case "create": {
      const mails = createMailStore(sql);
      const position = await mails.position("inbox");
      if (position === null)
        throw new Error("Iris ne connaît aucun mail : lance d'abord npm run mail:sort");
      const sent = await mails.sent();
      let target: number | undefined;
      for (const m of await mails.inbox()) {
        if (followUpOf(m, sent, now) !== "due") continue;
        if (await store.existsFor(position.uidValidity, m.uid)) continue;
        target = m.uid;
        break;
      }
      if (target === undefined) throw new Error("aucune relance due sans proposition");
      const { mail } = loadCadre();
      const [read] = await readMailsForModel(
        mail,
        testMailboxConfigFromEnv().password,
        [target],
        position.uidValidity,
      );
      if (read === undefined) throw new Error(`le mail ${target} n'est plus sur le serveur`);
      const { trames, signature } = loadTrames();
      const trame = trames.get("accuse_reception");
      if (trame === undefined) throw new Error("trame accuse_reception absente");
      const prenom = firstName(read.fromName);
      const conversation = [read.subject, read.text];
      const r = renderTrame(
        trame,
        { ...(prenom === null ? {} : { prenom }), objet: read.subject.replace(/^re:\s*/i, "") },
        conversation,
        signature,
      );
      const p = await proposals.propose({
        id: `p-${randomBytes(4).toString("hex")}`,
        mailUidValidity: position.uidValidity,
        mailUid: target,
        trame: trame.id,
        draft: r.text,
      });
      const check = checkDraft(r.text, [...conversation, signature]);
      console.log(`✔ proposition ${p.id} — « ${read.subject} »\n`);
      console.log(r.text.replace(/^/gm, "   │ "));
      console.log(
        `\n   ${check.ok ? "✔ aucun fait inventé" : `🟥 ${check.unsupported.map((f) => f.raw).join(" · ")}`}`,
      );
      if (r.toComplete.length > 0)
        console.log(`   ✏️  à compléter avant d'accepter : ${r.toComplete.join(", ")}`);
      break;
    }
    case "list":
      for (const p of await store.pending())
        console.log(`${p.id} (${p.trame ?? "libre"})\n${p.draft ?? ""}\n`);
      break;
    case "edit":
      if (id === undefined || text === undefined) throw new Error('usage : edit <id> "<texte>"');
      await store.edit(id, text.replace(/\\n/g, "\n"));
      console.log(`✔ ${id} modifiée`);
      break;
    case "accept": {
      const p = await proposals.accept(id ?? "", now);
      console.log(
        `✔ ${p.id} acceptée — envoi possible après ${p.sendAfter?.toLocaleTimeString("fr-FR")} (annulable jusque-là) — c'est l'exécuteur qui l'envoie (npm run executor).`,
      );
      break;
    }
    case "refuse":
      await proposals.refuse(id ?? "", now);
      console.log(`✔ ${id} refusée — elle ne reviendra pas pour ce mail`);
      break;
    case "cancel":
      await proposals.cancel(id ?? "", now);
      console.log(`✔ ${id} annulée`);
      break;
    default:
      throw new Error("commande : create | list | edit | accept | refuse | cancel");
  }
} catch (error) {
  console.error(`🛑 ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
