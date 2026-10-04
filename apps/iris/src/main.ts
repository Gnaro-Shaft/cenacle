/**
 * Iris's rhythm (phase 3, S4). Usage: npm run iris
 * Every minute: collect if due, alert, recap — see tick.ts. Ctrl+C or /stop
 * on Telegram ends it. It never sends a mail: only Telegram messages to me.
 */
import { createLocalModels, localModelConfigFromEnv } from "@cenacle/brain";
import { heartbeatFromEnv, refuseForeignSecrets } from "@cenacle/core";
import {
  connectAsApp,
  createJournal,
  createMailStore,
  createPeople,
  createProposalStore,
  createPurges,
  readAllEvents,
} from "@cenacle/journal";
import {
  keyerFromEnv,
  loadCadre,
  loadRules,
  mailTotals,
  runMailPass,
  testMailboxConfigFromEnv,
} from "@cenacle/mail";
import { createTelegramApi } from "@cenacle/telegram/api";
import { draftDueFollowUps } from "./draft-due.ts";
import { draftingDeps } from "./drafting.ts";
import { purgeDue } from "./purge.ts";
import { tick } from "./tick.ts";

// Iris can never accept: she must not even hold the page's key (ADR-0013).
refuseForeignSecrets("Iris", ["mail", "telegram", "sentinel"]);
const chatId = Number(process.env.TELEGRAM_ALLOWED_CHAT_ID);
if (!Number.isSafeInteger(chatId) || chatId === 0) {
  throw new Error("TELEGRAM_ALLOWED_CHAT_ID is missing or not a number (see .env.example)");
}
const telegram = createTelegramApi(process.env.TELEGRAM_BOT_TOKEN ?? "");
const sql = connectAsApp();
const journal = createJournal(sql);
const store = createMailStore(sql);
const keyer = keyerFromEnv();
const { mail, conservation } = loadCadre();
const { rules, noFollowUp } = loadRules();
const { password } = testMailboxConfigFromEnv();
const local = createLocalModels(localModelConfigFromEnv());
const proposalStore = createProposalStore(sql);
const drafting = draftingDeps({
  local,
  journal,
  mails: store,
  store: proposalStore,
  cadre: mail,
  password,
});
const startedAt = new Date();
// S2: the sentinel hears Iris every minute; its silence is the alert.
const sentinel = heartbeatFromEnv("iris");
let sentinelDown = false;
if (sentinel === null)
  console.log(
    "ℹ Sentinelle non configurée (CENACLE_SENTINEL_URL absent) : aucun battement envoyé.",
  );

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});

console.log(
  "Iris suit son rythme : relève toutes les 15 min (8 h–20 h en semaine), brouillons pour les relances dues, récaps 9 h / 13 h / 18 h.",
);
while (!stopping) {
  try {
    const outcome = await tick({
      now: () => new Date(),
      startedAt,
      journal,
      store,
      events: (agent) => readAllEvents(journal, agent),
      runPass: async () => {
        await runMailPass({
          journal,
          store,
          keyer,
          cadre: mail,
          retentionDays: conservation.memoireJours,
          opposedKeys: () => createPeople(sql).opposedKeys(),
          password,
          rules,
          noFollowUp,
          local,
        });
      },
      totals: (now) => mailTotals(store, now),
      send: (text) => telegram.sendMessage(chatId, text),
      draft: async () => {
        await draftDueFollowUps(drafting);
      },
      pendingDrafts: async () => (await proposalStore.pending()).length,
      heartbeat: async () => {
        if (sentinel === null) return;
        const ok = await sentinel.beat();
        if (!ok && !sentinelDown)
          console.error(
            "⚠ Sentinelle injoignable : battement non reçu (on réessaie chaque minute)",
          );
        if (ok && sentinelDown) console.log("✔ Sentinelle de nouveau jointe");
        sentinelDown = !ok;
      },
      purge: async () => {
        await purgeDue({
          now: () => new Date(),
          journal,
          events: () => readAllEvents(journal, "iris"),
          conservation,
          wipeTexts: (now, days) => proposalStore.wipeOldTexts(now, days),
          purges: createPurges(sql),
        });
      },
    });
    if (outcome === "stopped") {
      console.log("🛑 Arrêt d'urgence demandé sur Telegram : Iris s'arrête.");
      break;
    }
  } catch (error) {
    // Already journaled by the pass (Iris shows sick); keep the rhythm, try again next minute.
    console.error(
      `⚠ ${error instanceof Error ? error.name : "error"} — nouvel essai dans 1 minute`,
    );
  }
  for (let s = 0; s < 60 && !stopping; s++) await new Promise((r) => setTimeout(r, 1000));
}
await sql.end();
