/**
 * Shows the templates filled for the due follow-ups of the test mailbox.
 * The choice of template and the thread values are mine (fixtures/trame-choices.json);
 * Iris's own choices are measured by npm run draft:vote. Usage: npm run trames:demo
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkDraft, loadFixtureMailbox } from "@cenacle/core";
import { firstName, loadTrames, renderTrame, type SlotValues } from "@cenacle/mail";

const CHOICES = (
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "..", "..", "fixtures", "trame-choices.json"),
      "utf8",
    ),
  ) as { choices: Record<string, { trame: string; values: SlotValues }> }
).choices;

const { trames, signature, example } = loadTrames();
if (example) console.log("ℹ trames : trames.example.toml (exemple) — pas de trames.local.toml\n");
for (const m of loadFixtureMailbox().messages.filter((x) => x.expected.followUp === "due")) {
  const choice = CHOICES[m.id];
  const trame = choice === undefined ? undefined : trames.get(choice.trame);
  if (choice === undefined || trame === undefined) {
    console.log(`— ${m.id} : aucune trame choisie\n`);
    continue;
  }
  const conversation = [m.subject, m.body];
  const values: SlotValues = {
    ...choice.values,
    ...(firstName(m.from.name) === null ? {} : { prenom: firstName(m.from.name) ?? "" }),
    objet: m.subject.replace(/^re:\s*/i, ""),
  };
  const r = renderTrame(trame, values, conversation, signature);
  const check = checkDraft(r.text, [...conversation, signature]);
  console.log(`— ${m.id} « ${m.subject} » → ${trame.titre}`);
  console.log(r.text.replace(/^/gm, "   │ "));
  console.log(
    `   ${check.ok ? "✔ aucun fait inventé" : `🟥 ${check.unsupported.map((f) => f.raw).join(" · ")}`}${r.toComplete.length > 0 ? ` — à compléter par toi : ${r.toComplete.join(", ")}` : ""}\n`,
  );
}
