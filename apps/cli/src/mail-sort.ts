/**
 * Iris collects the mail once: reads what is new (inbox and Sent, read-only),
 * remembers it as keys, sorts what the rules know (exact domain, no model),
 * then asks the local model for the rest (closed list, "À trier" in doubt).
 * Usage: npm run mail:sort [-- --rules-only]
 */
import { createLocalModels, localModelConfigFromEnv } from "@cenacle/brain";
import { countConversations } from "@cenacle/core";
import { connectAsApp, createJournal, createMailStore, createPeople } from "@cenacle/journal";
import {
  keyerFromEnv,
  loadCadre,
  loadRules,
  mailTotals,
  runMailPass,
  testMailboxConfigFromEnv,
} from "@cenacle/mail";

const rulesOnly = process.argv.includes("--rules-only");
const sql = connectAsApp();
try {
  const store = createMailStore(sql);
  const { mail, conservation } = loadCadre();
  const { rules, noFollowUp, example } = loadRules();
  if (example) {
    console.log("ℹ règles : regles.example.toml (domaines fictifs) — pas de regles.local.toml");
  }
  const { collected: summary, model } = await runMailPass({
    journal: createJournal(sql),
    store,
    keyer: keyerFromEnv(),
    cadre: mail,
    retentionDays: conservation.memoireJours,
    opposedKeys: () => createPeople(sql).opposedKeys(),
    password: testMailboxConfigFromEnv().password,
    rules,
    noFollowUp,
    local: rulesOnly ? null : createLocalModels(localModelConfigFromEnv()),
  });
  const c = summary.ruleSort.counts;
  const byRule = c.clients_prospects + c.administratif + c.bruit;
  const conversations = countConversations([...(await store.inbox()), ...(await store.sent())]);
  console.log(
    `✔ ${summary.count} nouveaux mails mémorisés, ${summary.sentCount} envoyés lus — ${conversations} conversations reconstituées`,
  );
  console.log(
    `✔ règles : ${byRule} rangés (clients ${c.clients_prospects}, admin ${c.administratif}, bruit ${c.bruit}), ${c.a_trier} à trier (expéditeur illisible)`,
  );
  if (summary.purged > 0) {
    console.log(`🗑 ${summary.purged} mails oubliés (partis du serveur, ou de plus de 90 jours)`);
  }
  if (model !== null) {
    const m = model.counts;
    console.log(
      `✔ modèle : ${model.classified.length} rangés (clients ${m.clients_prospects}, admin ${m.administratif}, bruit ${m.bruit}, à trier ${m.a_trier} dont ${m.invalid} réponses invalides) en ${Math.round(model.durationMs / 1000)} s`,
    );
    if (model.waiting > 0) {
      console.log(`⏸ le modèle ne répond plus : ${model.waiting} mails attendent le Mac`);
    }
  } else if (summary.uncategorized.length > 0) {
    console.log(`… ${summary.uncategorized.length} mails attendent le modèle`);
  }
  const t = await mailTotals(store, new Date());
  console.log(
    `  mémoire : clients ${t.clients_prospects}, admin ${t.administratif}, bruit ${t.bruit}, à trier ${t.a_trier}, en attente ${t.pending} — ${summary.unseen} toujours non lus`,
  );
  console.log(`  suivi : ${t.waiting} en attente de réponse, 🔔 ${t.due} relances dues`);
  if (summary.truncated) console.log("… plafond atteint : relancer pour lire la suite");
} catch (error) {
  console.error(`🛑 ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
