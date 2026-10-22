/**
 * The prospection agent (ADR-0032). Usage: npm run prospection
 * Reads the "missions" alerts not yet read (ADR-0031), read-only, extracts
 * their missions with the local model, sorts them into the board's columns
 * and keeps them as cards; then purges the old cards. It writes to nobody,
 * opens no link, acts on nothing. launchd starts it every 15 minutes; it does
 * nothing outside Iris's hours (8 h–20 h on weekdays), when nothing arrives.
 */
import { randomBytes } from "node:crypto";
import {
  askAgent,
  createLocalModels,
  localModelConfigFromEnv,
  ModelUnavailableError,
} from "@cenacle/brain";
import { errorText, isQuiet, refuseForeignSecrets, sensitiveCategory } from "@cenacle/core";
import {
  connectOrQuit,
  createJournal,
  createLocationStore,
  createMailStore,
  createProspectionStore,
  holdSingleInstance,
} from "@cenacle/journal";
import {
  CadreError,
  createLocator,
  KeyError,
  keyerFromEnv,
  loadCadre,
  mailPassword,
  readRawSourcesAt,
  senderOfSource,
} from "@cenacle/mail";
import {
  EXTRACT_SYSTEM_PROMPT,
  loadProspectionConfig,
  ProspectionConfigError,
  runProspection,
} from "@cenacle/prospection";

if (process.argv.length > 2) throw new Error("usage : npm run prospection");
refuseForeignSecrets("L'agent prospection", ["mail", "telegram"]);
if (isQuiet(new Date())) {
  console.log("Heures calmes : Iris ne relève pas, rien de nouveau à lire.");
  process.exit(0);
}

const cadre = loadCadre();
const retentionDays = cadre.conservation.prospectionJours;
if (retentionDays === undefined) {
  console.error("🛑 cadre : [conservation] prospection_jours manque (T-09, ADR-0032).");
  process.exit(1);
}
const config = loadProspectionConfig();
if (config.example) {
  console.log("(prospection.local.toml absent : plateformes et profil FICTIFS de l'exemple)");
}
// One alert of 8 000 characters in, a few dozen short missions out.
const local = createLocalModels({
  ...localModelConfigFromEnv(),
  contextWindow: 32_768,
  maxTokens: 6_000,
});
const sql = connectOrQuit();
const lockSql = connectOrQuit("lock");
const instance = await holdSingleInstance(lockSql, "prospection");
if (instance === null) {
  console.error("🛑 L'agent prospection tourne déjà : celui-ci ne fait rien.");
  await Promise.all([lockSql.end(), sql.end()]);
  process.exit(75);
}
const journal = createJournal(sql);
const mails = createMailStore(sql);
const cards = createProspectionStore(sql);

try {
  const mailPass = mailPassword(cadre);
  const locator = createLocator({
    cadre: cadre.mail,
    password: mailPass,
    keyer: keyerFromEnv(),
    locations: createLocationStore(sql),
  });
  const { counts, waiting } = await runProspection({
    config,
    journal,
    missionMails: async () =>
      (await mails.inbox())
        .filter((m) => m.category === "missions")
        .map((m) => ({ id: m.uid, senderAuthenticated: m.senderAuthenticated })),
    unread: (ids) => cards.unread(ids),
    readSources: (ids) => readRawSourcesAt(locator, cadre.mail, mailPass, ids),
    senderDomain: (source) => senderOfSource(source)?.split("@")[1] ?? null,
    sensitive: (text) => sensitiveCategory(text) !== null,
    ask: async (question) =>
      (
        await askAgent({
          question,
          agent: "prospection",
          systemPrompt: EXTRACT_SYSTEM_PROMPT,
          // A platform's alert: mail content, the local model only (ADR-0003).
          dataClass: "mail_content",
          journal,
          local,
          timeoutMs: 10 * 60_000,
        })
      ).text,
    isModelUnavailable: (error) => error instanceof ModelUnavailableError,
    recordMail: (id, outcome, kept) =>
      cards.recordMail(
        id,
        outcome,
        kept.map((c) => ({
          source: "mail",
          platform: c.platform,
          title: c.title,
          company: c.company,
          intermediary: c.intermediary,
          stack: c.stack,
          rate: c.rate,
          remote: c.remote,
          place: c.place,
          link: c.link,
          note: null,
          column: c.column,
          reason: c.reason,
          decidedBy: c.decidedBy,
          toCheck: c.toCheck,
          duplicateKey: c.duplicateKey,
        })),
      ),
    purge: (cutoff) => cards.purge(cutoff),
    retentionDays,
    now: () => new Date(),
    nonce: () => randomBytes(6).toString("hex"),
  });
  const shown = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join(" · ");
  console.log(`✔ prospection : ${shown === "" ? "rien de nouveau" : shown}`);
  if (waiting) console.log("⏸ le modèle local ne répond pas : la suite au prochain passage");
} catch (error) {
  console.error(`🛑 ${errorText(error, [ProspectionConfigError, CadreError, KeyError])}`);
  process.exitCode = 1;
} finally {
  instance.release();
  await Promise.all([lockSql.end(), sql.end()]);
}
