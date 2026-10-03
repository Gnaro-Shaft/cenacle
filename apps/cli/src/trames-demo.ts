/**
 * Shows the templates filled for the due follow-ups of the test mailbox.
 * The choice of template and the thread values are written here by hand —
 * from B2 on, Iris makes them. Usage: npm run trames:demo
 */
import { checkDraft, loadFixtureMailbox } from "@cenacle/core";
import { firstName, loadTrames, renderTrame, type SlotValues } from "@cenacle/mail";

const CHOICES: Record<string, { trame: string; values: SlotValues }> = {
  m003: { trame: "accuse_reception", values: {} },
  m005: { trame: "confirmer_creneau", values: { creneau: "jeudi" } },
  m010: { trame: "accuse_reception", values: {} },
  m013: { trame: "proposer_creneau", values: {} },
  m031: { trame: "proposer_creneau", values: {} },
  m034: { trame: "proposer_creneau", values: {} },
  m044: {
    trame: "prise_en_charge",
    values: { sujet: "les identifiants de l'environnement de recette" },
  },
  m057: { trame: "confirmer_creneau", values: { creneau: "vendredi à 10 h" } },
  m071: { trame: "confirmer_creneau", values: { creneau: "jeudi" } },
  m091: { trame: "prise_en_charge", values: { sujet: "l'erreur 500" } },
  m119: { trame: "confirmer_creneau", values: { creneau: "vendredi à 10 h" } },
  m146: { trame: "demander_precision", values: {} },
};

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
