/**
 * Fills the TEST mailbox (GreenMail, on this machine) with the fictional fixtures.
 * Usage: npm run mail:load [-- --reset]
 */
import { loadFixtureMailbox } from "@cenacle/core";
import { loadFixtures, testMailboxConfigFromEnv } from "@cenacle/mail";

const reset = process.argv.includes("--reset");
try {
  const { messages } = loadFixtureMailbox();
  const counts = await loadFixtures(testMailboxConfigFromEnv(), messages, { reset });
  console.log(`✔ INBOX: ${counts.messages} messages (${counts.unseen} unread) in the test mailbox`);
} catch (error) {
  console.error(`🛑 ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
