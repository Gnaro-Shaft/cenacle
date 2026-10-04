/**
 * Fills a TEST mailbox with the fictional fixtures: GreenMail on this machine,
 * or, with a cadre.local.toml, a real mailbox marked `test = true` (M1) —
 * never one that is not marked. Usage: npm run mail:load [-- --reset]
 */

import { existsSync } from "node:fs";
import { loadFixtureMailbox, loadFixtureSent } from "@cenacle/core";
import {
  LOCAL_CADRE_PATH,
  loadCadre,
  loadFixtures,
  mailPassword,
  testMailboxConfigFromEnv,
} from "@cenacle/mail";

const reset = process.argv.includes("--reset");
try {
  const { messages } = loadFixtureMailbox();
  const sent = loadFixtureSent();
  const local = existsSync(LOCAL_CADRE_PATH) ? loadCadre(LOCAL_CADRE_PATH) : null;
  if (local !== null && !local.mail.test) {
    throw new Error("cadre.local.toml: this mailbox is not marked test = true");
  }
  const config =
    local === null
      ? testMailboxConfigFromEnv()
      : { ...local.mail, password: mailPassword(local), markedTest: true };
  const counts = await loadFixtures(config, messages, { reset, sent });
  console.log(`✔ INBOX: ${counts.messages} messages (${counts.unseen} unread) in the test mailbox`);
  console.log(`✔ Sent: ${sent.messages.length} of my sent mails (already read)`);
} catch (error) {
  console.error(`🛑 ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
