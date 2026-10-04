/**
 * Measures Iris's drafts on the due follow-ups of the test mailbox (phase 4, B2).
 * Needs the local model (LM Studio). No database, nothing stored, nothing sent.
 * Reference: my own choices in fixtures/trame-choices.json.
 * Usage: npm run draft:vote
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  chooseTrame,
  createLocalModels,
  extractThreadSlots,
  isThreadSlot,
  localModelConfigFromEnv,
} from "@cenacle/brain";
import { checkDraft, loadFixtureMailbox } from "@cenacle/core";
import { firstName, fixtureForModel, keptFromModel, loadTrames, renderTrame } from "@cenacle/mail";

const REFERENCE = (
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "..", "..", "fixtures", "trame-choices.json"),
      "utf8",
    ),
  ) as { choices: Record<string, { trame: string; values: Record<string, string> }> }
).choices;

const local = createLocalModels(localModelConfigFromEnv());
const { trames, signature, example } = loadTrames();
if (example) console.log("ℹ trames : trames.example.toml (exemple)\n");
const options = [...trames.values()].map((t) => ({ id: t.id, quand: t.quand }));
const { messages } = loadFixtureMailbox();

let same = 0;
let other = 0;
let split = 0;
let none = 0;
let invented = 0;
let slotsAsked = 0;
let slotsFilled = 0;
const started = Date.now();
for (const [i, m] of messages.entries()) {
  if (m.expected.followUp !== "due") continue;
  const mail = fixtureForModel(i + 1, m);
  const mine = REFERENCE[m.id]?.trame ?? "?";
  if (keptFromModel(mail)) {
    console.log(`· ${m.id} écarté du modèle (plancher article 9) — rien n'est proposé`);
    continue;
  }
  const vote = await chooseTrame(mail, options, { local });
  const tally = Object.entries(vote.votes)
    .map(([k, v]) => `${k}×${v}`)
    .join(" ");
  if (vote.choice === null) {
    split += 1;
    console.log(`⚖️  ${m.id} vote partagé (${tally}) → rien proposé, moi : ${mine}\n`);
    continue;
  }
  const trame = trames.get(vote.choice);
  if (trame === undefined) {
    none += 1;
    console.log(`∅  ${m.id} aucune trame (${tally}) → rien proposé, moi : ${mine}\n`);
    continue;
  }
  if (vote.choice === mine) same += 1;
  else other += 1;
  const wanted = trame.slots.filter(isThreadSlot);
  const copied = await extractThreadSlots(mail, wanted, { local });
  slotsAsked += wanted.length;
  const prenom = firstName(mail.fromName);
  const conversation = [mail.subject, mail.text];
  const r = renderTrame(
    trame,
    {
      ...copied,
      ...(prenom === null ? {} : { prenom }),
      objet: mail.subject.replace(/^re:\s*/i, ""),
    },
    conversation,
    signature,
  );
  slotsFilled += wanted.filter((s) => !r.toComplete.includes(s)).length;
  const check = checkDraft(r.text, [...conversation, trame.texte, signature]);
  if (!check.ok) invented += 1;
  const mark = vote.choice === mine ? "✔" : "≠";
  console.log(`${mark}  ${m.id} « ${m.subject} » → ${trame.id} (${tally}), moi : ${mine}`);
  for (const s of wanted)
    console.log(
      `   case {${s}} : ${copied[s] ?? "—"}${r.refused.includes(s) ? " 🟥 refusée" : ""}`,
    );
  console.log(r.text.replace(/^/gm, "   │ "));
  console.log(
    check.ok ? "" : `   🟥 fait inventé : ${check.unsupported.map((f) => f.raw).join(" · ")}\n`,
  );
}
const total = same + other + split + none;
console.log("— Bilan —");
console.log(
  `relances dues : ${total} · même trame que moi : ${same} · autre trame : ${other} · vote partagé : ${split} · aucune : ${none}`,
);
console.log(
  `cases du fil remplies : ${slotsFilled}/${slotsAsked} · brouillons avec fait inventé : ${invented} (doit être 0)`,
);
console.log(`durée : ${Math.round((Date.now() - started) / 1000)} s`);
if (invented > 0) process.exitCode = 1;
