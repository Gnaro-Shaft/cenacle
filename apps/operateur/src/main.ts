/**
 * The operator (J6f, ADR-0027): the only program that holds the servers'
 * keys and runs ssh. launchd starts it every minute; one pass at a time.
 * It acts only on a request I confirmed on Telegram, only if the switch in
 * securite.toml is on, and only after checking everything again. It holds
 * the Telegram token to tell me the outcome, and no other secret: the keys
 * are files of mine, readable by me only, named in serveurs.local.toml.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { errorText, refuseForeignSecrets, UsageError } from "@cenacle/core";
import {
  connectOrQuit,
  createJournal,
  createServeurActions,
  holdSingleInstance,
} from "@cenacle/journal";
import {
  LEGION_VERDICT_PATH,
  parseLegionVerdict,
  parseServerSwitch,
  parseServers,
  type ServersConfig,
} from "@cenacle/securite";
import { createTelegramApi } from "@cenacle/telegram/api";
import { runOperator } from "./run.ts";
import { keyIsPrivate, runSsh } from "./ssh.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");

refuseForeignSecrets("L'opérateur", ["telegram"]);

const read = (path: string): string | null => {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
};

function servers(): ServersConfig | null {
  const text = read(join(ROOT, "serveurs.local.toml"));
  if (text === null) return null;
  try {
    return parseServers(text);
  } catch {
    // Said at the first request ("serveurs.local.toml est illisible"), never a failed pass.
    return null;
  }
}

async function pass(sql: ReturnType<typeof connectOrQuit>): Promise<void> {
  const chatId = Number(process.env.TELEGRAM_ALLOWED_CHAT_ID);
  if (!Number.isSafeInteger(chatId) || chatId === 0) {
    throw new UsageError("TELEGRAM_ALLOWED_CHAT_ID is missing or not a number (see .env.example)");
  }
  const telegram = createTelegramApi(process.env.TELEGRAM_BOT_TOKEN ?? "");
  const outcome = await runOperator({
    store: createServeurActions(sql),
    active: parseServerSwitch(read(join(ROOT, "securite.toml")) ?? ""),
    config: servers(),
    verdict: () => read(LEGION_VERDICT_PATH),
    parseVerdict: parseLegionVerdict,
    keyIsPrivate: (path) => keyIsPrivate(path),
    ssh: (args) => runSsh(args),
    send: (text) => telegram.sendMessage(chatId, text),
    journal: createJournal(sql),
    now: () => new Date(),
  });
  if (outcome.ran + outcome.refused + outcome.verified + outcome.told > 0) {
    console.log(
      `✔ Opérateur : ${outcome.ran} action(s), ${outcome.refused} refus, ${outcome.verified} preuve(s), ${outcome.told} message(s)`,
    );
  }
}

const sql = connectOrQuit();
const lockSql = connectOrQuit("lock");
let instance: Awaited<ReturnType<typeof holdSingleInstance>> = null;
try {
  instance = await holdSingleInstance(lockSql, "operateur");
  if (instance === null) {
    console.error("🛑 Un autre passage de l'opérateur tourne déjà : celui-ci ne fait rien.");
    process.exitCode = 75;
  } else await pass(sql);
} catch (error) {
  console.error(`🛑 ${errorText(error, [UsageError])}`);
  process.exitCode = 1;
} finally {
  await instance?.release();
  await Promise.all([lockSql.end(), sql.end()]);
}
