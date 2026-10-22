/**
 * The survey of my mission platforms (ADR-0032), to fill prospection.local.toml
 * and the [missions] rule of regles.local.toml.
 * Usage: npm run prospection:releve [-- --jours <n>] [mot …]
 * (default words: linkedin free-work malt collective; default 60 days)
 *
 * Reads, read-only, the mails of every folder Iris reads whose sender's
 * domain holds one of the words, and prints per word: how many, their exact
 * sender addresses, and the hosts of their links. Never a subject, a text nor
 * a whole link. Nothing is stored, nothing is journaled.
 *
 * Like regles:domaines, it refuses to run unless its output is a terminal:
 * real addresses must not end up in a file, a pipe, or an assistant's transcript.
 */
import { stdout } from "node:process";
import { errorText, refuseForeignSecrets, UsageError } from "@cenacle/core";
import {
  forTerminal,
  KeyError,
  keyerFromEnv,
  listFolders,
  loadCadre,
  mailPassword,
  platformSourcesSince,
} from "@cenacle/mail";
import { ranked, surveyArgs, tallyPlatforms } from "./prospection-tally.ts";

if (stdout.isTTY !== true) {
  console.error(
    "🛑 cette commande affiche des adresses réelles : lance-la toi-même, dans un terminal (sortie redirigée ou capturée : refusé)",
  );
  process.exit(1);
}
refuseForeignSecrets("Le relevé des plateformes", ["mail"]);

try {
  const parsed = surveyArgs(process.argv.slice(2));
  if (typeof parsed === "string") throw new UsageError(forTerminal(parsed, 120));
  const { days, words } = parsed;
  const cadre = loadCadre();
  const mailPass = mailPassword(cadre);
  const folders = await listFolders(cadre.mail, mailPass, keyerFromEnv());
  const since = new Date(Date.now() - days * 86_400_000);
  const sources = await platformSourcesSince(
    cadre.mail,
    mailPass,
    folders.map((f) => f.path),
    since,
    words,
  );
  const tally = await tallyPlatforms(sources, words);
  console.log(`Plateformes, ${days} derniers jours, ${folders.length} dossiers lus\n`);
  for (const [word, t] of tally) {
    console.log(`■ ${word} — ${t.mails} mail${t.mails > 1 ? "s" : ""}`);
    if (t.mails === 0) {
      console.log("  aucun mail d'un domaine qui contient ce mot\n");
      continue;
    }
    console.log("  expéditeurs (l'adresse des alertes va dans [missions] de regles.local.toml) :");
    for (const [address, n] of ranked(t.senders).slice(0, 10)) {
      console.log(`    ${String(n).padStart(4)}  ${forTerminal(address, 80)}`);
    }
    console.log("  hôtes des liens (à mettre dans hotes_liens de prospection.local.toml) :");
    for (const [host, n] of ranked(t.hosts).slice(0, 12)) {
      console.log(`    ${String(n).padStart(4)}  ${forTerminal(host, 80)}`);
    }
    console.log("");
  }
} catch (error) {
  console.error(`🛑 ${errorText(error, [KeyError, UsageError])}`);
  process.exitCode = 1;
}
