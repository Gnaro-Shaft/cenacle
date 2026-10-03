/**
 * Runs the fact checker (no model) on the evaluation drafts. Usage: npm run draft:check
 * Each draft may only state facts found in the mail it answers.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkDraft, loadFixtureMailbox } from "@cenacle/core";

interface EvalDraft {
  readonly id: string;
  readonly mail: string;
  readonly ok: boolean;
  readonly text: string;
  readonly unsupported: readonly string[];
}
const path = join(import.meta.dirname, "..", "..", "..", "fixtures", "drafts.json");
const { drafts } = JSON.parse(readFileSync(path, "utf8")) as { drafts: EvalDraft[] };
const mails = new Map(loadFixtureMailbox().messages.map((m) => [m.id, m]));
const signature = "Camille Exemple (fictif) — Cabinet Exemple";

let wrong = 0;
for (const d of drafts) {
  const mail = mails.get(d.mail);
  if (mail === undefined) throw new Error(`unknown mail ${d.mail}`);
  const check = checkDraft(d.text.replace("{signature}", signature), [
    mail.subject,
    mail.body,
    signature,
  ]);
  const found = check.unsupported.map((f) => `${f.kind}:${f.value}`).sort();
  const agrees = check.ok === d.ok && found.join() === [...d.unsupported].sort().join();
  if (!agrees) wrong++;
  const verdict = check.ok
    ? "✔ aucun fait inventé"
    : `🟥 ${check.unsupported.map((f) => f.raw).join(" · ")}`;
  console.log(`${agrees ? "✓" : "✗"} ${d.id} (${d.mail}) ${verdict}`);
}
console.log(`\n${drafts.length - wrong}/${drafts.length} brouillons jugés comme attendu`);
process.exitCode = wrong === 0 ? 0 : 1;
