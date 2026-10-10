/**
 * The CTO's veille (J5, ADR-0024). Usage: npm run veille [-- --sans-envoi <fichier>]
 * With --sans-envoi, the message is written to that file (for me only), not sent.
 * Reads the feeds of veille.toml, asks the local model which articles matter
 * and for which of my projects (veille.local.toml), and sends me the summary
 * on Telegram. A program of its own: it holds the Telegram token and nothing
 * else — the CTO's service holds no secret (S1).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { askAgent, createLocalModels, localModelConfigFromEnv } from "@cenacle/brain";
import { errorText, refuseForeignSecrets } from "@cenacle/core";
import {
  loadVeilleConfig,
  readFeeds,
  runVeille,
  VEILLE_SYSTEM_PROMPT,
  VeilleConfigError,
} from "@cenacle/cto/veille";
import { connectOrQuit, createJournal } from "@cenacle/journal";
import { createTelegramApi } from "@cenacle/telegram/api";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const [flag, dryRunFile] = process.argv.slice(2);
if (flag !== undefined && (flag !== "--sans-envoi" || dryRunFile === undefined)) {
  throw new Error("usage : npm run veille [-- --sans-envoi <fichier>]");
}

refuseForeignSecrets("La veille", ["telegram"]);
const chatId = Number(process.env.TELEGRAM_ALLOWED_CHAT_ID);
if (!Number.isSafeInteger(chatId) || chatId === 0) {
  throw new Error("TELEGRAM_ALLOWED_CHAT_ID is missing or not a number (see .env.example)");
}
const telegram = createTelegramApi(process.env.TELEGRAM_BOT_TOKEN ?? "");
// Some 50 articles and the map of my projects in, ~40 scored entries out.
const local = createLocalModels({
  ...localModelConfigFromEnv(),
  contextWindow: 65_536,
  maxTokens: 8_000,
});
const sql = connectOrQuit();
const journal = createJournal(sql);

try {
  const config = loadVeilleConfig(ROOT);
  const started = Date.now();
  const outcome = await runVeille({
    config,
    read: () => readFeeds(config.sources, config.settings.fenetreHeures, { fetch, now: Date.now }),
    ask: async (question) =>
      (
        await askAgent({
          question,
          agent: "cto",
          systemPrompt: VEILLE_SYSTEM_PROMPT,
          // Public articles and the names of my own projects: nobody's data.
          dataClass: "no_personal_data",
          journal,
          local,
          timeoutMs: 20 * 60_000,
        })
      ).text,
    send: async (text) => {
      if (dryRunFile === undefined) return telegram.sendMessage(chatId, text);
      writeFileSync(dryRunFile, `${text}\n`, { mode: 0o600 });
    },
    // Nothing sent, nothing journaled as sent.
    journal:
      dryRunFile === undefined
        ? journal
        : {
            append: async (e) => ({
              id: 0n,
              occurredAt: new Date(),
              agent: e.agent,
              type: e.type,
              payload: e.payload ?? {},
            }),
            read: async () => [],
          },
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (line) => console.error(line),
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(
    outcome.kind === "sent"
      ? `✔ Veille ${dryRunFile === undefined ? "envoyée" : "écrite sans envoi"} en ${seconds} s : ${outcome.kept} retenu(s) sur ${outcome.scanned} lu(s), ${outcome.failed} source(s) injoignable(s)`
      : `⚠ Veille non faite (${outcome.reason}) : le message l'a dit`,
  );
} catch (error) {
  console.error(`🛑 ${errorText(error, [VeilleConfigError])} — veille non envoyée`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
