/**
 * Iris collects the mail: reads what is new (inbox and Sent, read-only),
 * remembers it as keys, sorts what the rules know (exact domain, no model),
 * then asks the local model for the rest (closed list, "À trier" in doubt).
 * Usage: npm run mail:sort [-- --rules-only]
 */
import { createLocalModels, localModelConfigFromEnv, sortByModel } from "@cenacle/brain";
import { countConversations } from "@cenacle/core";
import { connectAsApp, createJournal, createMailStore } from "@cenacle/journal";
import {
  collectMail,
  fetchMailRefs,
  fetchSentRefs,
  keyerFromEnv,
  loadCadre,
  loadRules,
  readMailsForModel,
  testMailboxConfigFromEnv,
} from "@cenacle/mail";

const rulesOnly = process.argv.includes("--rules-only");
const sql = connectAsApp();
try {
  const journal = createJournal(sql);
  const store = createMailStore(sql);
  const keyer = keyerFromEnv();
  const { mail } = loadCadre();
  const { rules, example } = loadRules();
  if (example) {
    console.log("ℹ règles : regles.example.toml (domaines fictifs) — pas de regles.local.toml");
  }
  const { password } = testMailboxConfigFromEnv();
  const summary = await collectMail({
    journal,
    store,
    rules,
    fetchInbox: (afterUid) => fetchMailRefs(mail, password, keyer, { afterUid }),
    fetchSent: (afterUid) => fetchSentRefs(mail, password, keyer, { afterUid }),
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
  if (summary.purged > 0)
    console.log(`🗑 ${summary.purged} mails oubliés (conservation : 90 jours)`);

  const pending = summary.uncategorized;
  if (!rulesOnly && pending.length > 0) {
    const local = createLocalModels(localModelConfigFromEnv());
    const mails = await readMailsForModel(mail, password, pending);
    const sorted = await sortByModel(mails, {
      journal,
      local,
      onClassified: async (r) => {
        await store.categorize(r.uid, r.category, "model");
      },
    });
    await journal.append({
      agent: "iris",
      type: "mail.totals",
      payload: { ...(await store.totals()) },
    });
    const m = sorted.counts;
    console.log(
      `✔ modèle : ${sorted.classified.length} rangés (clients ${m.clients_prospects}, admin ${m.administratif}, bruit ${m.bruit}, à trier ${m.a_trier} dont ${m.invalid} réponses invalides) en ${Math.round(sorted.durationMs / 1000)} s`,
    );
    if (sorted.waiting > 0) {
      console.log(`⏸ le modèle ne répond plus : ${sorted.waiting} mails attendent le Mac`);
    }
  } else if (pending.length > 0) {
    console.log(`… ${pending.length} mails attendent le modèle`);
  }
  const t = await store.totals();
  console.log(
    `  mémoire : clients ${t.clients_prospects}, admin ${t.administratif}, bruit ${t.bruit}, à trier ${t.a_trier}, en attente ${t.pending} — ${summary.unseen} toujours non lus`,
  );
  if (summary.truncated) console.log("… plafond atteint : relancer pour lire la suite");
} catch (error) {
  console.error(`🛑 ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
