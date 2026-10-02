/** Prints what the fictional test mailbox contains. Usage: npm run fixtures:stats */
import { CATEGORIES, loadFixtureMailbox } from "@cenacle/core";

const { messages } = loadFixtureMailbox();
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
