/**
 * The rights of a person Iris reads about (phase 5, C3 — GDPR art. 15-21).
 * Usage:
 *   npm run personne -- export --out <fichier.json>   what Iris holds (access, portability)
 *   npm run personne -- efface                         erase, and ignore their mails from now on
 *   npm run personne -- retire                         they withdraw their objection
 * The address is asked at the prompt, never passed as an argument: it would
 * stay in the shell history. The export file is written for me only, never
 * over an existing file. Every action is journaled as counts, never who.
 */

import { writeFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { errorText, UsageError } from "@cenacle/core";
import { connectOrQuit, createJournal, createPeople } from "@cenacle/journal";
import { KeyError, keyerFromEnv } from "@cenacle/mail";
import { ExportLabelError, personExport } from "./person-export.ts";

const [action, flag, out] = process.argv.slice(2);
const USAGE = "usage : personne export --out <fichier.json> | efface | retire";

// One reader for every answer, read line after line: a second interface would
// lose what was already typed (or piped) for it, and stop without a word.
const rl = createInterface({ input: stdin, output: stdout });
const lines = rl[Symbol.asyncIterator]();
async function ask(question: string): Promise<string> {
  stdout.write(question);
  const answer = await lines.next();
  if (answer.done === true) throw new UsageError("réponse manquante : rien n'a été fait");
  return String(answer.value).trim();
}

const sql = connectOrQuit();
try {
  if (!["export", "efface", "retire"].includes(action ?? "")) throw new UsageError(USAGE);
  if (action === "export" && (flag !== "--out" || out === undefined)) throw new UsageError(USAGE);
  const address = await ask("Adresse de la personne : ");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new UsageError("adresse illisible");
  const key = keyerFromEnv().address(address);
  const people = createPeople(sql);
  const journal = createJournal(sql);

  if (action === "export") {
    const held = await people.holdings(key);
    // In the notice's words, never Iris's identifiers (person-export.ts).
    const document = personExport(held, new Date());
    writeFileSync(out ?? "", `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await journal.append({
      agent: "cenacle",
      type: "person.exported",
      payload: {
        received: held.received.length,
        sentTo: held.sentTo.length,
        proposals: held.proposals.length,
      },
    });
    console.log(
      `✔ export écrit (lisible par toi seul) : ${held.received.length} mails reçus, ${held.sentTo.length} mails envoyés, ${held.proposals.length} propositions${held.opposed ? ", sur la liste d'opposition" : ""}`,
    );
  } else if (action === "efface") {
    const confirm = await ask("Tout effacer et ignorer ses mails désormais ? Tape EFFACER : ");
    if (confirm !== "EFFACER") throw new UsageError("rien n'a été effacé");
    const erased = await people.erase(key);
    await journal.append({ agent: "cenacle", type: "person.erased", payload: { ...erased } });
    console.log(
      `✔ effacé : ${erased.received} mails reçus, ${erased.proposals} propositions ; retiré de ${erased.sentTo} mails envoyés. Ses mails seront ignorés désormais.`,
    );
    // The list is backed up with the secrets: an opposition newer than the last backup would be lost with the base.
    console.log(
      "ℹ refais la sauvegarde chiffrée pour y inclure cette opposition : npm run secrets:backup -- --out <fichier>",
    );
  } else {
    const was = await people.withdraw(key);
    await journal.append({ agent: "cenacle", type: "person.withdrawn", payload: { was } });
    console.log(
      was
        ? "✔ retirée de la liste d'opposition : ses prochains mails seront de nouveau lus"
        : "ℹ cette adresse n'était pas sur la liste d'opposition",
    );
  }
} catch (error) {
  // Our own messages only: a database's could quote the address.
  console.error(`🛑 ${errorText(error, [KeyError, ExportLabelError])}`);
  process.exitCode = 1;
} finally {
  rl.close();
  await sql.end();
}
