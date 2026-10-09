/**
 * Iris on Telegram. Usage: npm run bot
 * Long polling: the Mac calls Telegram, Telegram never calls the Mac.
 */
import { projectStatus, refuseForeignSecrets } from "@cenacle/core";
import { connectAsApp, createJournal, holdSingleInstance, readAllEvents } from "@cenacle/journal";
import { createTelegramApi } from "./api.ts";
import { handleUpdate } from "./handler.ts";

const allowedChatId = Number(process.env.TELEGRAM_ALLOWED_CHAT_ID);
if (!Number.isSafeInteger(allowedChatId) || allowedChatId === 0) {
  throw new Error("TELEGRAM_ALLOWED_CHAT_ID is missing or not a number (see .env.example)");
}
const api = createTelegramApi(process.env.TELEGRAM_BOT_TOKEN ?? "");
// The bot holds its token, and nothing of the mailbox, the page or the database owner (S1).
refuseForeignSecrets("The Telegram bot", ["telegram"]);
const sql = connectAsApp();
const journal = createJournal(sql);
// One bot at a time (ADR-0019): Telegram refuses two pollers (409), and the
// refused one would crash and be restarted every 30 s.
const lockSql = connectAsApp();
const instance = await holdSingleInstance(lockSql, "bot");
if (instance === null) {
  console.error("🛑 Un autre bot Telegram tourne déjà : celui-ci ne démarre pas.");
  await Promise.all([lockSql.end(), sql.end()]);
  process.exit(75);
}

async function readStatus(agent: string) {
  return projectStatus(agent, await readAllEvents(journal, agent));
}

let offset = 0;
let stopping = false;
// Ctrl+C, or SIGTERM when macOS logs out or launchd unloads the bot.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    console.log("Stopping after the current poll…");
  });
}

console.log("Iris is listening on Telegram (Ctrl+C to stop).");
while (!stopping) {
  const updates = await api.getUpdates(offset, 25);
  for (const update of updates) {
    offset = update.update_id + 1;
    for (const action of await handleUpdate(update, { allowedChatId, readStatus })) {
      if (action.kind === "reply") {
        await api.sendMessage(action.chatId, action.text);
      } else {
        await journal.append({
          agent: "cenacle",
          type: action.type,
          payload: action.type === "telegram.rejected" ? { reason: action.reason } : {},
        });
      }
    }
  }
}
await instance.release();
await Promise.all([lockSql.end(), sql.end()]);
process.exit(0);
