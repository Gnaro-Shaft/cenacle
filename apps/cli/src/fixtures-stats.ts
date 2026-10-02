/** Prints what the fictional test mailbox contains. Usage: npm run fixtures:stats */
import { CATEGORIES, FOLLOW_UPS, loadFixtureMailbox, loadFixtureSent } from "@cenacle/core";

const { messages, followUp } = loadFixtureMailbox();
const sent = loadFixtureSent().messages;
console.log(`${messages.length} fictional messages\n`);
for (const category of CATEGORIES) {
  const inCategory = messages.filter((m) => m.expected.category === category);
  const urgent = inCategory.filter((m) => m.expected.urgent).length;
  const traps = inCategory.filter((m) => m.expected.trap !== null).length;
  console.log(
    `${category.padEnd(18)} ${String(inCategory.length).padStart(3)}   urgent: ${urgent}   traps: ${traps}`,
  );
}
const senders = new Set(messages.map((m) => m.from.address.split("@")[1])).size;
console.log(`\n${senders} distinct sender domains, all under .example or .test`);
console.log("Traps:");
for (const m of messages.filter((x) => x.expected.trap !== null)) {
  console.log(`  ${m.id}  ${m.expected.trap}  → expected ${m.expected.category}`);
}

console.log(`\nConversations (phase 3) — ${sent.length} of my sent mails in Sent:`);
console.log(
  `  ${sent.filter((s) => s.inReplyTo !== null).length} replies in a thread, ${sent.filter((s) => s.inReplyTo === null).length} fresh mails`,
);
console.log(
  `  ${messages.filter((m) => m.inReplyTo !== null).length} incoming mails reply to one of mine`,
);
console.log(
  `Expected follow-up at ${followUp.now} (${followUp.workingHours} working hours, ${followUp.timeZone}):`,
);
for (const f of FOLLOW_UPS) {
  console.log(
    `  ${f.padEnd(12)} ${String(messages.filter((m) => m.expected.followUp === f).length).padStart(3)}`,
  );
}
