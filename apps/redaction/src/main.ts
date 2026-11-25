/**
 * The drafting program (ADR-0049, L3). Usage: npm run redaction
 * Reads, read-only, the mails I filed in the « travail » folder since the
 * opening, and has the local model draft a demand to the house from each one,
 * waiting for my reading on the page. It never sends anything to the house:
 * it does not know the way (the `liaison` program alone holds the key). It
 * tells me on Telegram how many drafts wait, never a text. launchd starts it
 * every 15 minutes; closed (no `redaction_ouverte`, or a date to come), it does nothing.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  askAgent,
  createLocalModels,
  localModelConfigFromEnv,
  ModelUnavailableError,
} from "@cenacle/brain";
import { errorText, refuseForeignSecrets, sensitiveCategory, UsageError } from "@cenacle/core";
import {
  connectOrQuit,
  createJournal,
  createLiaisonRedaction,
  createLocationStore,
  holdOrQuit,
  waitForDatabase,
} from "@cenacle/journal";
import {
  CadreError,
  createLocator,
  KeyError,
  keyerFromEnv,
  loadCadre,
  mailPassword,
  readMailsForModelAt,
} from "@cenacle/mail";
import {
  LIAISON_CONFIG_FILE,
  LiaisonConfigError,
  type LiaisonConfigProblem,
  parseLiaisonDossiers,
  parseLiaisonRedaction,
} from "@cenacle/securite";
import { createTelegramApi } from "@cenacle/telegram/api";
import { rediger } from "./redaction.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const AGENT = "redaction";

if (process.argv.length > 2) throw new Error("usage : npm run redaction");
refuseForeignSecrets("La rédaction", ["mail", "telegram"]);

const path = join(ROOT, LIAISON_CONFIG_FILE);
const text = existsSync(path) ? readFileSync(path, "utf8") : null;
let config: ReturnType<typeof parseLiaisonRedaction> = null;
let dossier: string | undefined;
try {
  config = text === null ? null : parseLiaisonRedaction(text);
  dossier = text === null ? undefined : parseLiaisonDossiers(text)[0];
} catch (e) {
  if (!(e instanceof LiaisonConfigError)) throw e;
  // Its kind only, from a closed list: the message never quotes a value of the file.
  const probleme: LiaisonConfigProblem = e.problem;
  console.error(`🛑 ${LIAISON_CONFIG_FILE} refusé (${probleme}) : rien n'est rédigé.`);
  process.exit(1);
}
// Closed: nothing written, or opened on a day to come. Said by nothing: it is the normal state.
if (config === null || config.ouverte.getTime() > Date.now() || dossier === undefined) {
  process.exit(0);
}

const cadre = loadCadre();
if (cadre.conservation.liaisonTexteJours === undefined) {
  console.error("🛑 cadre : [conservation] liaison_texte_jours manque (T-12) : rien n'est rédigé.");
  process.exit(1);
}
const chatId = Number(process.env.TELEGRAM_ALLOWED_CHAT_ID);
if (!Number.isSafeInteger(chatId) || chatId === 0) {
  throw new UsageError("TELEGRAM_ALLOWED_CHAT_ID is missing or not a number (see .env.example)");
}
const telegram = createTelegramApi(process.env.TELEGRAM_BOT_TOKEN ?? "");
// One mail of 2 000 characters in, a short draft out.
const local = createLocalModels({
  ...localModelConfigFromEnv(),
  contextWindow: 16_384,
  maxTokens: 3_000,
});
const sql = await waitForDatabase(connectOrQuit());
const lockSql = connectOrQuit("lock");
const instance = await holdOrQuit(
  lockSql,
  sql,
  AGENT,
  "La rédaction tourne déjà : celle-ci ne fait rien.",
);
const journal = createJournal(sql);
const store = createLiaisonRedaction(sql);

try {
  const keyer = keyerFromEnv();
  const password = mailPassword(cadre);
  const locator = createLocator({
    cadre: cadre.mail,
    password,
    keyer,
    locations: createLocationStore(sql),
  });
  const folderKey = keyer.folder(config.dossierTravail);
  const ouverte = config.ouverte;
  const target = dossier;
  const { counts, waiting } = await rediger({
    aRediger: () => store.aRediger(folderKey, ouverte, 10),
    lire: (ids) => readMailsForModelAt(locator, cadre.mail, password, ids),
    sensible: (t) => sensitiveCategory(t) !== null,
    ask: async (question, systemPrompt) =>
      (
        await askAgent({
          question,
          agent: "redaction",
          systemPrompt,
          // A mail a correspondent wrote: the local model only (ADR-0003).
          dataClass: "mail_content",
          journal,
          local,
          timeoutMs: 10 * 60_000,
        })
      ).text,
    isModelUnavailable: (error) => error instanceof ModelUnavailableError,
    brouillon: (id, t) => store.brouillon(id, t, target),
    marquer: (id, issue) => store.marquer(id, issue),
    nonce: () => randomBytes(6).toString("hex"),
  });
  if (Object.keys(counts).length > 0 || waiting) {
    await journal.append({
      agent: AGENT,
      type: "redaction.passe",
      payload: { ...counts, waiting },
    });
  }
  const nouveaux = counts.brouillon ?? 0;
  if (nouveaux > 0) {
    const attente = await store.enAttente();
    await telegram.sendMessage(
      chatId,
      `📝 ${nouveaux} brouillon(s) de demande rédigé(s) depuis un mail — ${attente} à relire sur la page, onglet Maison. Retire tout nom avant d'accepter.`,
    );
  }
  const shown = Object.entries(counts)
    .map(([k, n]) => `${k} ${n}`)
    .join(" · ");
  if (shown !== "") console.log(`✔ rédaction : ${shown}`);
  if (waiting) console.log("⏸ le modèle local ne répond pas : la suite au prochain passage");
} catch (error) {
  console.error(`🛑 ${errorText(error, [CadreError, KeyError, UsageError])}`);
  process.exitCode = 1;
} finally {
  instance.release();
  await Promise.all([lockSql.end(), sql.end()]);
}
