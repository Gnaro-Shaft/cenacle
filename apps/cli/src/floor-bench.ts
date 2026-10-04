/**
 * The article 9 floor bench (phase 5, C2). No model, no database.
 * - Every fictional sensitive mail (fixtures/sensibles.json) must be set aside.
 * - On the 147 ordinary fictional mails, the mails wrongly set aside are
 *   counted and named: the price of preferring to set aside wrongly.
 * Usage: npm run floor:bench
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type FixtureMessage, loadFixtureMailbox } from "@cenacle/core";
import { fixtureForModel, keptFromModel } from "@cenacle/mail";

const path = join(import.meta.dirname, "..", "..", "..", "fixtures", "sensibles.json");
const sensitive = (
  JSON.parse(readFileSync(path, "utf8")) as {
    messages: (Pick<FixtureMessage, "id" | "from" | "subject" | "contentType" | "body"> & {
      note: string;
    })[];
  }
).messages;
const ordinary = loadFixtureMailbox().messages;

const leaked = sensitive.filter((m, i) => !keptFromModel(fixtureForModel(i + 1, m)));
for (const m of sensitive) {
  console.log(`${leaked.includes(m) ? "✗ donné au modèle" : "✓ écarté"}  ${m.id} — ${m.note}`);
}
const wrongly = ordinary.filter((m, i) => keptFromModel(fixtureForModel(i + 1, m)));
console.log(
  `\nMails sensibles écartés : ${sensitive.length - leaked.length}/${sensitive.length} (objectif : tous)`,
);
console.log(
  `Mails ordinaires écartés à tort : ${wrongly.length}/${ordinary.length}${wrongly.length > 0 ? ` (${wrongly.map((m) => m.id).join(", ")} — rangés à la main dans « À trier »)` : ""}`,
);
console.log(
  leaked.length === 0 ? "\n✅ 0 mail sensible donné au modèle" : "\n❌ des mails sensibles passent",
);
process.exitCode = leaked.length === 0 ? 0 : 1;
