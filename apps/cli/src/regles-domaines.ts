/**
 * The domains that write to me and that I write to, to help me write
 * regles.local.toml (phase 5, M2). Usage: npm run regles:domaines [-- --jours <n>]
 *
 * Reads the From headers of the inbox and the To/Cc headers of Sent over the
 * last <n> days (182 by default) — read-only (EXAMINE, unread count checked
 * before and after), headers only, never a subject nor a body. Prints domains
 * and counts at the terminal; nothing is stored, nothing is journaled.
 * The opposition list is honoured. Mass-market mailboxes are flagged.
 *
 * It reads before the date of the notice, unlike Iris: a bounded exception
 * decided on 2026-10-05 (the owner looking at his own mailbox, domains only,
 * for his rules). So it refuses to run unless its output is a terminal: real
 * domains must not end up in a file, a pipe, or an assistant's transcript.
 */
import { stdout } from "node:process";
import { errorText, refuseForeignSecrets, SecretPlacementError, UsageError } from "@cenacle/core";
import { connectOrQuit, createPeople } from "@cenacle/journal";
import {
  censusDomains,
  forTerminal,
  headersSince,
  KeyError,
  keyerFromEnv,
  loadCadre,
  loadRules,
  mailPassword,
  splitHeaders,
} from "@cenacle/mail";

const MAX_DAYS = 366;

if (stdout.isTTY !== true) {
  console.error(
    "🛑 cette commande affiche des domaines réels : lance-la toi-même, dans un terminal (sortie redirigée ou capturée : refusé)",
  );
  process.exit(1);
}
refuseForeignSecrets("Le recensement des domaines", ["mail"]);
const daysArg = process.argv.indexOf("--jours");
const days = daysArg === -1 ? 182 : Number(process.argv[daysArg + 1]);
const sql = connectOrQuit();
try {
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    throw new UsageError(`--jours attend un entier de 1 à ${MAX_DAYS}`);
  }
  const cadre = loadCadre();
  const keyer = keyerFromEnv();
  const opposedKeys = await createPeople(sql).opposedKeys();
  const { rules, noFollowUp, example } = loadRules();
  const since = new Date(Date.now() - days * 86_400_000);
  const { inbox, sent } = await headersSince(cadre.mail, mailPassword(cadre), since);
  const census = censusDomains({
    inbox: inbox.map((b) => splitHeaders(b).get("from") ?? null),
    sent: sent.map((b) => {
      const h = splitHeaders(b);
      return { to: h.get("to") ?? null, cc: h.get("cc") ?? null };
    }),
    isOpposed: (address) => opposedKeys.has(keyer.address(address)),
    myDomain: cadre.mail.address.split("@")[1] ?? null,
  });

  console.log(
    `Domaines des ${days} derniers jours — ${inbox.length} reçus, ${sent.length} envoyés`,
  );
  console.log(
    `(règles lues : ${example ? "regles.example.toml, domaines fictifs" : "regles.local.toml"})\n`,
  );
  console.log(`${"domaine".padEnd(40)} reçus  envoyés  remarque`);
  for (const d of census.domains) {
    const rule = rules.get(d.domain);
    const notes = [
      d.mine ? "ton domaine" : "",
      d.massMarket ? "messagerie grand public : jamais en règle" : "",
      rule === undefined ? "" : `déjà en règle : ${rule}`,
      noFollowUp.has(d.domain) ? "sans suivi" : "",
    ].filter((n) => n !== "");
    console.log(
      `${forTerminal(d.domain, 40).padEnd(40)} ${String(d.received).padStart(5)}  ${String(d.sent).padStart(7)}  ${notes.join(" ; ")}`,
    );
  }
  console.log(
    `\n${census.domains.length} domaines ; ${census.unreadable} expéditeurs illisibles ; ${census.opposed} mails ignorés (liste d'opposition). Rien n'a été enregistré.`,
  );
} catch (error) {
  console.error(`🛑 ${errorText(error, [SecretPlacementError, KeyError])}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
