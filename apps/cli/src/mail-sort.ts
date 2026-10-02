/**
 * Iris collects the mail, sorts what the rules know (exact domain, no model),
 * then asks the local model for the rest (closed list, "À trier" when in doubt).
 * Usage: npm run mail:sort [-- --after <uid>] [-- --rules-only]
 */
import { createLocalModels, localModelConfigFromEnv, sortByModel } from "@cenacle/brain";
import { connectAsApp, createJournal } from "@cenacle/journal";
import {
  collectMail,
  fetchMailRefs,
  loadCadre,
  loadRules,
  readMailsForModel,
  testMailboxConfigFromEnv,
} from "@cenacle/mail";

const afterIndex = process.argv.indexOf("--after");
const afterUid = afterIndex === -1 ? 0 : Number(process.argv[afterIndex + 1]);
const rulesOnly = process.argv.includes("--rules-only");
const sql = connectAsApp();
try {
  const journal = createJournal(sql);
  const { mail } = loadCadre();
  const { rules, example } = loadRules();
  if (example)
    console.log("ℹ règles : regles.example.toml (domaines fictifs) — pas de regles.local.toml");
  const { password } = testMailboxConfigFromEnv();
  const summary = await collectMail({
    journal,
    fetch: () => fetchMailRefs(mail, password, { afterUid }),
    rules,
  });
  const c = summary.ruleSort?.counts;
  if (c === undefined || summary.ruleSort === undefined) throw new Error("rules were not applied");
  const byRule = c.clients_prospects + c.administratif + c.bruit;
  console.log(
    `✔ ${summary.count} relevés : ${byRule} rangés par règle (clients ${c.clients_prospects}, admin ${c.administratif}, bruit ${c.bruit}), ${c.a_trier} à trier (expéditeur illisible), ${c.remaining} restants pour le modèle`,
  );

  const remaining = summary.ruleSort.remaining;
  if (!rulesOnly && remaining.length > 0) {
    const local = createLocalModels(localModelConfigFromEnv());
    const mails = await readMailsForModel(
      mail,
      password,
      remaining.map((ref) => ref.uid),
    );
    const sorted = await sortByModel(mails, { journal, local });
    const m = sorted.counts;
    console.log(
      `✔ modèle : ${sorted.classified.length} rangés (clients ${m.clients_prospects}, admin ${m.administratif}, bruit ${m.bruit}, à trier ${m.a_trier} dont ${m.invalid} réponses invalides) en ${Math.round(sorted.durationMs / 1000)} s`,
    );
    if (sorted.waiting > 0) {
      console.log(`⏸ le modèle ne répond plus : ${sorted.waiting} mails attendent le Mac`);
    }
  }
  console.log(`  ${summary.unseen} toujours non lus`);
  if (summary.truncated) {
    console.log(`… plafond atteint : relancer avec -- --after ${summary.lastUid}`);
  }
} catch (error) {
  console.error(`🛑 ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
