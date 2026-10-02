/**
 * Iris collects the mail and sorts what the rules know (exact domain, no model).
 * Usage: npm run mail:sort [-- --after <uid>]
 */
import { connectAsApp, createJournal } from "@cenacle/journal";
import {
  collectMail,
  fetchMailRefs,
  loadCadre,
  loadRules,
  testMailboxConfigFromEnv,
} from "@cenacle/mail";

const afterIndex = process.argv.indexOf("--after");
const afterUid = afterIndex === -1 ? 0 : Number(process.argv[afterIndex + 1]);
const sql = connectAsApp();
try {
  const { mail } = loadCadre();
  const { rules, example } = loadRules();
  if (example)
    console.log("ℹ règles : regles.example.toml (domaines fictifs) — pas de regles.local.toml");
  const { password } = testMailboxConfigFromEnv();
  const summary = await collectMail({
    journal: createJournal(sql),
    fetch: () => fetchMailRefs(mail, password, { afterUid }),
    rules,
  });
  const c = summary.ruleSort?.counts;
  if (c === undefined) throw new Error("rules were not applied");
  const byRule = c.clients_prospects + c.administratif + c.bruit;
  console.log(
    `✔ ${summary.count} relevés : ${byRule} rangés par règle (clients ${c.clients_prospects}, admin ${c.administratif}, bruit ${c.bruit}), ${c.a_trier} à trier (expéditeur illisible), ${c.remaining} restants pour le modèle`,
  );
  console.log(`  ${summary.unseen} toujours non lus (${summary.durationMs} ms)`);
  if (summary.truncated) {
    console.log(`… plafond atteint : relancer avec -- --after ${summary.lastUid}`);
  }
} catch (error) {
  console.error(`🛑 ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
