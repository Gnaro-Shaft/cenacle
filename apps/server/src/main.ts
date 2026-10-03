/**
 * Starts the API on 127.0.0.1 only. Usage: npm run server
 * A new token is drawn at each start and shown once here: open the link it
 * prints to use the validation page.
 */
import {
  connectAsApp,
  createJournal,
  createMailStore,
  createProposalStore,
} from "@cenacle/journal";
import {
  createProposals,
  loadCadre,
  loadTrames,
  readMailsForModel,
  readReplyTargets,
  testMailboxConfigFromEnv,
} from "@cenacle/mail";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { defaultGuardConfig, newToken } from "./guard.ts";
import { createProposalsService } from "./proposals-service.ts";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CENACLE_API_PORT ?? 8787);

const sql = connectAsApp();
const journal = createJournal(sql);
const store = createProposalStore(sql);
const mails = createMailStore(sql);
const { mail } = loadCadre();
const { password } = testMailboxConfigFromEnv();
const token = newToken();

const app = createApp({
  readAfter: (agent, afterId) => journal.read({ agent, afterId, limit: 1000 }),
  guard: defaultGuardConfig(token, PORT),
  proposals: createProposalsService({
    store,
    proposals: createProposals(store, journal),
    uidValidity: async () => (await mails.position("inbox"))?.uidValidity ?? null,
    readMails: (uids, v) => readMailsForModel(mail, password, uids, v),
    readTargets: (uids, v) => readReplyTargets(mail, password, uids, v),
    trames: loadTrames(),
    now: () => new Date(),
  }),
});

serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
  console.log(`Cénacle API listening on http://${HOST}:${info.port}`);
  console.log(
    `Page (jeton valable jusqu'à l'arrêt du serveur) : http://${HOST}:5173/#jeton=${token}`,
  );
});
