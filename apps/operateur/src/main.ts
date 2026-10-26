/**
 * The operator (J6f, ADR-0027): the only program that holds the servers'
 * keys and runs ssh. launchd starts it every minute; one pass at a time.
 * It acts only on a request I confirmed on Telegram, only if the switch in
 * securite.toml is on, and only after checking everything again. It holds
 * the Telegram token to tell me the outcome, and no other secret: the keys
 * are files of mine, readable by me only, named in serveurs.local.toml.
 * It also sends the maintenance summary (J7c, ADR-0035), read only: being
 * the only reader of serveurs.local.toml, it knows each machine's keys.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { errorText, refuseForeignSecrets, UsageError } from "@cenacle/core";
import {
  connectOrQuit,
  createJournal,
  createPlanStore,
  createSecuriteStore,
  createServeurActions,
  holdSingleInstance,
  latestEventAt,
} from "@cenacle/journal";
import {
  LEGION_VERDICT_PATH,
  OPERATOR_STATE_PATH,
  parseLegionVerdict,
  parseMaintenanceSwitch,
  parseServerSwitch,
  parseServers,
  type ServersConfig,
  ServersConfigError,
  type ServersConfigProblem,
} from "@cenacle/securite";
import { createTelegramApi } from "@cenacle/telegram/api";
import { drivePlan } from "./plan.ts";
import { runRecap } from "./recap.ts";
import { runOperator } from "./run.ts";
import { keyIsPrivate, runSsh } from "./ssh.ts";
import { publishState } from "./state.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");

refuseForeignSecrets("L'opérateur", ["telegram"]);

const read = (path: string): string | null => {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
};

function servers(): ServersConfig | ServersConfigProblem {
  const text = read(join(ROOT, "serveurs.local.toml"));
  if (text === null) return "absent";
  try {
    return parseServers(text);
  } catch (e) {
    // Said at the first request, by its kind (npm run serveurs:verifier for the
    // detail), never a failed pass.
    if (e instanceof ServersConfigError) return e.problem;
    throw e;
  }
}

async function pass(sql: ReturnType<typeof connectOrQuit>): Promise<void> {
  const chatId = Number(process.env.TELEGRAM_ALLOWED_CHAT_ID);
  if (!Number.isSafeInteger(chatId) || chatId === 0) {
    throw new UsageError("TELEGRAM_ALLOWED_CHAT_ID is missing or not a number (see .env.example)");
  }
  const telegram = createTelegramApi(process.env.TELEGRAM_BOT_TOKEN ?? "");
  const config = servers();
  // Said at every pass, so a blocked list is found without waiting for a request.
  publishState(OPERATOR_STATE_PATH, config, Date.now());
  const store = createServeurActions(sql);
  const journal = createJournal(sql);
  const securiteToml = read(join(ROOT, "securite.toml")) ?? "";
  const send = (text: string) => telegram.sendMessage(chatId, text);
  // The validated maintenance plan (J7d), before the actions: a step it
  // launches runs in this same pass.
  await drivePlan({
    active: parseMaintenanceSwitch(securiteToml),
    plans: createPlanStore(sql),
    actions: store,
    verdict: () => read(LEGION_VERDICT_PATH),
    parseVerdict: parseLegionVerdict,
    send,
    journal,
    now: () => new Date(),
  });
  const outcome = await runOperator({
    store,
    active: parseServerSwitch(securiteToml),
    config,
    verdict: () => read(LEGION_VERDICT_PATH),
    parseVerdict: parseLegionVerdict,
    keyIsPrivate: (path) => keyIsPrivate(path),
    ssh: (args) => runSsh(args),
    send,
    journal,
    now: () => new Date(),
  });
  // The maintenance summary (J7c): after the actions, read only.
  const recap = await runRecap({
    active: parseMaintenanceSwitch(securiteToml),
    serversActive: parseServerSwitch(securiteToml),
    config,
    findings: () => createSecuriteStore(sql).open(),
    lastRestarts: () => store.lastAnswers("services"),
    last: async () => ({
      morning: await latestEventAt(sql, "operateur", "maintenance.recap", { quand: "matin" }),
      any: await latestEventAt(sql, "operateur", "maintenance.recap"),
      asked: await latestEventAt(sql, "cenacle", "maintenance.demande"),
    }),
    send,
    journal,
    now: () => new Date(),
  });
  if (recap > 0) console.log("✔ Opérateur : récapitulatif de maintenance envoyé");
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
