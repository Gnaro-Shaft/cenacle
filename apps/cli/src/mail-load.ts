/**
 * Fills the TEST mailbox (GreenMail, on this machine) with the fictional fixtures.
 * Usage: npm run mail:load [-- --reset]
 */
import { loadFixtureMailbox, loadFixtureSent } from "@cenacle/core";
import { loadFixtures, testMailboxConfigFromEnv } from "@cenacle/mail";

const reset = process.argv.includes("--reset");
try {
  const { messages } = loadFixtureMailbox();
  const sent = loadFixtureSent();
  const counts = await loadFixtures(testMailboxConfigFromEnv(), messages, { reset, sent });
  console.log(`✔ INBOX: ${counts.messages} messages (${counts.unseen} unread) in the test mailbox`);
  console.log(`✔ Sent: ${sent.messages.length} of my sent mails (already read)`);
} catch (error) {
  console.error(`🛑 ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
