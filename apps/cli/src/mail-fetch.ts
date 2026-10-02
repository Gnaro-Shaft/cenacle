/**
 * Iris collects the mail: reads UIDs and sender domains, changes nothing.
 * Usage: npm run mail:fetch [-- --after <uid>]
 */
import { connectAsApp, createJournal } from "@cenacle/journal";
import { collectMail, fetchMailRefs, loadCadre, testMailboxConfigFromEnv } from "@cenacle/mail";

const afterIndex = process.argv.indexOf("--after");
const afterUid = afterIndex === -1 ? 0 : Number(process.argv[afterIndex + 1]);
const sql = connectAsApp();
try {
  const { mail } = loadCadre();
  // Phase 2: the only mailbox is the test one, so its password is the test password.
  const { password } = testMailboxConfigFromEnv();
  const summary = await collectMail({
    journal: createJournal(sql),
    fetch: () => fetchMailRefs(mail, password, { afterUid }),
  });
  console.log(
    `✔ ${summary.count} relevés, ${summary.domains} domaines, ${summary.unseen} toujours non lus (${summary.durationMs} ms)`,
  );
  if (summary.truncated) {
    console.log(`… plafond atteint : relancer avec -- --after ${summary.lastUid}`);
  }
} catch (error) {
  console.error(`🛑 ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
