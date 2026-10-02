/**
 * Iris on Telegram. Usage: npm run bot
 * Long polling: the Mac calls Telegram, Telegram never calls the Mac.
 */
import { projectStatus } from "@cenacle/core";
import { connectAsApp, createJournal, readAllEvents } from "@cenacle/journal";
import { createTelegramApi } from "./api.ts";
import { handleUpdate } from "./handler.ts";

const allowedChatId = Number(process.env.TELEGRAM_ALLOWED_CHAT_ID);
if (!Number.isSafeInteger(allowedChatId) || allowedChatId === 0) {
  throw new Error("TELEGRAM_ALLOWED_CHAT_ID is missing or not a number (see .env.example)");
}
const api = createTelegramApi(process.env.TELEGRAM_BOT_TOKEN ?? "");
const journal = createJournal(connectAsApp());

async function readStatus(agent: string) {
  return projectStatus(agent, await readAllEvents(journal, agent));
}

let offset = 0;
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
  console.log("Stopping after the current poll…");
});

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
process.exit(0);
