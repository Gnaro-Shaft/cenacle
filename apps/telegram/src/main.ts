/**
 * Iris on Telegram. Usage: npm run bot
 * Long polling: the Mac calls Telegram, Telegram never calls the Mac.
 */
import { homedir } from "node:os";
import { projectStatus, refuseForeignSecrets } from "@cenacle/core";
import { askCtoService, ctoSocketPath } from "@cenacle/cto/client";
import {
  connectOrQuit,
  createJournal,
  createSecuriteDecisions,
  createSecuriteStore,
  holdSingleInstance,
  InvalidEventError,
  readAllEvents,
  watchOrQuit,
} from "@cenacle/journal";
import { perform } from "./actions.ts";
import { createTelegramApi, TelegramError, type TelegramFailure } from "./api.ts";
import { sleepUnless } from "./backoff.ts";
import { relayToCto } from "./cto-relay.ts";
import { handleUpdate } from "./handler.ts";
import { poll } from "./poll.ts";
import {
  handleCallback,
  handleReasonReply,
  listFindings,
  type SecuriteBotDeps,
} from "./securite-bot.ts";

const allowedChatId = Number(process.env.TELEGRAM_ALLOWED_CHAT_ID);
if (!Number.isSafeInteger(allowedChatId) || allowedChatId === 0) {
  throw new Error("TELEGRAM_ALLOWED_CHAT_ID is missing or not a number (see .env.example)");
}
const api = createTelegramApi(process.env.TELEGRAM_BOT_TOKEN ?? "");
// The bot holds its token, and nothing of the mailbox, the page or the database owner (S1).
refuseForeignSecrets("The Telegram bot", ["telegram"]);
const sql = connectOrQuit();
const journal = createJournal(sql);
// One bot at a time (ADR-0019): Telegram refuses two pollers (409), and the
// refused one would crash and be restarted every 30 s.
const lockSql = connectOrQuit("lock");
const instance = await holdSingleInstance(lockSql, "bot");
if (instance === null) {
  console.error("🛑 Un autre bot Telegram tourne déjà : celui-ci ne démarre pas.");
  await Promise.all([lockSql.end(), sql.end()]);
  process.exit(75);
}
// A cut of the database drops the lock silently: checked and taken again (ADR-0023).
watchOrQuit(instance, "Le bot Telegram");

async function readStatus(agent: string) {
  return projectStatus(agent, await readAllEvents(journal, agent));
}

// Questions to the CTO take minutes: relayed apart, so that /etat and /stop
// keep answering meanwhile (ADR-0020).
const relaying = new Set<{ chatId: number }>();
function relay(chatId: number, question: string): void {
  const job = { chatId };
  relaying.add(job);
  void relayToCto(question, {
    send: (text) => api.sendMessage(chatId, text),
    ask: (q) => askCtoService(ctoSocketPath(homedir()), q),
  }).finally(() => relaying.delete(job));
}

let stopping = false;
// Ctrl+C, or SIGTERM when macOS logs out or launchd unloads the bot.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    console.log("Stopping after the current poll…");
  });
}

/** A reply that cannot be sent is lost, said by name; the bot keeps going. */
async function reply(chatId: number, text: string): Promise<void> {
  try {
    await api.sendMessage(chatId, text);
  } catch (error) {
    if (!(error instanceof TelegramError)) throw error;
    // Only the failure's kind, one of four fixed words: never its message.
    const kind: TelegramFailure = error.kind;
    console.error(`⚠ Réponse non envoyée (${kind}) : elle est perdue, redemande`);
  }
}

// The security agent's buttons (J6b): decided in the database, never by AI.
const securite: SecuriteBotDeps = {
  allowedChatId,
  api,
  store: createSecuriteStore(sql),
  decisions: createSecuriteDecisions(sql),
  journal,
  now: () => new Date(),
};
/**
 * A database outage while a button is pressed must not bring the bot down
 * (the tap would come back after the restart, again and again, as in #75):
 * nothing was decided, and it is said. A Telegram failure only loses the
 * answer. An invalid event is our bug: it still throws.
 */
async function guarded<T>(work: () => Promise<T>, fallback: T, callbackId?: string): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof InvalidEventError) throw error;
    if (error instanceof TelegramError) {
      const kind: TelegramFailure = error.kind;
      console.error(`⚠ Bouton : réponse non envoyée (${kind})`);
      return fallback;
    }
    console.error("⚠ Bouton : décision non enregistrée, base injoignable");
    if (callbackId !== undefined) {
      await api
        .answerCallback(callbackId, "⚠ Base injoignable : rien n'a changé, réessaie plus tard.")
        .catch(() => {});
    }
    return fallback;
  }
}

console.log("Iris is listening on Telegram (Ctrl+C to stop).");
// A network cut or a Telegram outage is waited out and retried (poll.ts);
// anything unexpected still throws, and launchd restarts the bot.
await poll({
  getUpdates: (offset) => api.getUpdates(offset, 25),
  // A database outage no longer brings the bot down (actions.ts).
  handle: async (update) => {
    const tap = update.callback_query;
    if (tap !== undefined) {
      await guarded(() => handleCallback(tap, securite), undefined, tap.id);
      return;
    }
    const message = update.message;
    if (
      message !== undefined &&
      (await guarded(() => handleReasonReply(message, securite), false))
    ) {
      return;
    }
    await perform(await handleUpdate(update, { allowedChatId, readStatus }), {
      reply,
      askCto: relay,
      listFindings: (chatId) => guarded(() => listFindings(chatId, securite), undefined),
      record: async (type, payload) => {
        await journal.append({ agent: "cenacle", type, payload });
      },
      log: (line) => console.error(line),
    });
  },
  stopped: () => stopping,
  sleep: (ms) => sleepUnless(ms, () => stopping),
  log: (line) => console.log(line),
});
// A question still on its way is lost with the bot: say so, best effort.
for (const job of relaying) {
  await api
    .sendMessage(
      job.chatId,
      "⏹ Le bot s'arrête : ta question au CTO est abandonnée, repose-la plus tard.",
    )
    .catch(() => {});
}
await instance.release();
await Promise.all([lockSql.end(), sql.end()]);
process.exit(0);
