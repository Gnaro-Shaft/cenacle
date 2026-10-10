/**
 * The security agent (J6a, ADR-0025). Usage:
 *   npm run securite                              one round: checks, findings, message
 *   npm run securite -- constats                  what is open, accepted
 *   npm run securite -- accepter <n°> <raison>    I take the risk of an open finding
 * It checks, follows and proposes; it never fixes anything itself (charter,
 * rule 1). It holds the Telegram token and nothing else.
 */
import { randomBytes } from "node:crypto";
import { release } from "node:os";
import { dirname, join } from "node:path";
import {
  askAgent,
  createLocalModels,
  localModelConfigFromEnv,
  ModelUnavailableError,
} from "@cenacle/brain";
import { errorText, refuseForeignSecrets, UsageError } from "@cenacle/core";
import {
  connectOrQuit,
  createJournal,
  createSecuriteDecisions,
  createSecuriteStore,
  holdSingleInstance,
  readAllEvents,
} from "@cenacle/journal";
import {
  buildCommentPrompt,
  COMMENT_SYSTEM_PROMPT,
  cleanComment,
  keyboard,
  SEVERITY_LABEL,
} from "@cenacle/securite";
import { createTelegramApi } from "@cenacle/telegram/api";
import { runChecks, runProgram, specs } from "./checks.ts";
import { runRound } from "./round.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const USAGE = "usage : npm run securite [-- constats | accepter <n°> <raison>]";
const [command, ...rest] = process.argv.slice(2);

refuseForeignSecrets("L'agent sécurité", ["telegram"]);
const sql = connectOrQuit();
const store = createSecuriteStore(sql);

async function round(): Promise<void> {
  const chatId = Number(process.env.TELEGRAM_ALLOWED_CHAT_ID);
  if (!Number.isSafeInteger(chatId) || chatId === 0) {
    throw new UsageError("TELEGRAM_ALLOWED_CHAT_ID is missing or not a number (see .env.example)");
  }
  const telegram = createTelegramApi(process.env.TELEGRAM_BOT_TOKEN ?? "");
  const journal = createJournal(sql);
  const local = createLocalModels({
    ...localModelConfigFromEnv(),
    contextWindow: 8_192,
    maxTokens: 400,
  });
  // Darwin 25 is macOS 26: what tells a point release from a new major version.
  const macMajor = Number(release().split(".")[0]) + 1;
  const outcome = await runRound({
    checks: () => runChecks(specs(ROOT, dirname(process.execPath), macMajor), runProgram()),
    store,
    comment: async (f) => {
      try {
        const answer = await askAgent({
          question: buildCommentPrompt(f, randomBytes(6).toString("hex")),
          agent: "cto",
          systemPrompt: COMMENT_SYSTEM_PROMPT,
          // Package names and settings of my Mac: nobody's data.
          dataClass: "no_personal_data",
          journal,
          local,
          timeoutMs: 120_000,
        });
        return cleanComment(answer.text);
      } catch (error) {
        if (error instanceof ModelUnavailableError) return null;
        throw error;
      }
    },
    // Buttons under the findings still to fix, each with its single-use token (J6b).
    send: async (text, buttonsFor) => {
      const tokens = await createSecuriteDecisions(sql).tokens(buttonsFor);
      const rows = keyboard([...tokens].map(([id, token]) => ({ id, token })));
      if (rows.length === 0) return telegram.sendMessage(chatId, text);
      await telegram.sendWithButtons(
        chatId,
        text,
        rows.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
      );
    },
    journal,
    now: () => new Date(),
    lastWeekly: async () =>
      (await readAllEvents(journal, "securite")).findLast((e) => e.type === "securite.bilan")
        ?.occurredAt ?? null,
  });
  console.log(
    `✔ Sécurité : ${outcome.checks} contrôle(s), ${outcome.impossible} impossible(s) ; ${outcome.opened} nouveau(x), ${outcome.resolved} résolu(s), ${outcome.open} ouvert(s)${outcome.weekly ? " ; bilan de la semaine envoyé" : ""}`,
  );
}

async function list(): Promise<void> {
  const line = (f: { id: number; severity: keyof typeof SEVERITY_LABEL; title: string }) =>
    `  n°${f.id} · ${SEVERITY_LABEL[f.severity]} · ${f.title}`;
  const open = await store.open();
  const accepted = await store.accepted();
  console.log(
    open.length === 0 ? "Aucun constat ouvert." : `Ouverts :\n${open.map(line).join("\n")}`,
  );
  if (accepted.length > 0) {
    console.log(`Acceptés :\n${accepted.map((f) => `${line(f)} — ${f.reason ?? ""}`).join("\n")}`);
  }
}

async function accept(): Promise<void> {
  const [raw, ...words] = rest;
  const id = Number(raw);
  const reason = words.join(" ").trim();
  if (!Number.isSafeInteger(id) || id <= 0 || reason.length < 3) throw new UsageError(USAGE);
  if (!(await store.accept(id, reason, new Date()))) {
    throw new UsageError(`aucun constat ouvert n°${id} (npm run securite -- constats)`);
  }
  console.log(
    `✔ Constat n°${id} accepté : il se tait jusqu'à une nouvelle occurrence, et sera redemandé dans 90 jours.`,
  );
}

let instance: Awaited<ReturnType<typeof holdSingleInstance>> = null;
const lockSql = command === undefined ? connectOrQuit("lock") : null;
try {
  if (lockSql !== null) {
    // One round at a time: a second one sends nothing (75).
    instance = await holdSingleInstance(lockSql, "securite");
    if (instance === null) {
      console.error("🛑 Un autre passage de l'agent sécurité tourne déjà : celui-ci ne fait rien.");
      process.exitCode = 75;
    } else await round();
  } else if (command === "constats" && rest.length === 0) await list();
  else if (command === "accepter") await accept();
  else throw new UsageError(USAGE);
} catch (error) {
  console.error(`🛑 ${errorText(error, [UsageError])}`);
  process.exitCode = 1;
} finally {
  await instance?.release();
  await Promise.all([lockSql?.end(), sql.end()]);
}
