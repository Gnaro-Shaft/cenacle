/**
 * Starts the API on 127.0.0.1 only. Usage: npm run server
 * A new token is drawn at each start and shown once here: open the link it
 * prints to use the validation page. Signs my acceptances with the private
 * key of .env.page, loaded by this program only (ADR-0013).
 */
import { privateKeyFromEnv, refuseForeignSecrets } from "@cenacle/core";
import {
  connectAsApp,
  createJournal,
  createLocationStore,
  createMailStore,
  createProposalStore,
} from "@cenacle/journal";
import {
  createLocator,
  createProposals,
  keyerFromEnv,
  loadCadre,
  loadTrames,
  mailPassword,
  readMailsForModelAt,
  readReplyTargetsAt,
  signProposal,
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
const cadre = loadCadre();
const { mail } = cadre;
const password = mailPassword(cadre);
const locator = createLocator({
  cadre: mail,
  password,
  keyer: keyerFromEnv(),
  locations: createLocationStore(sql),
});
refuseForeignSecrets("The page's server", ["mail", "page"]);
const token = newToken();
const acceptKey = privateKeyFromEnv();

const app = createApp({
  readAfter: (agent, afterId) => journal.read({ agent, afterId, limit: 1000 }),
  guard: defaultGuardConfig(token, PORT),
  proposals: createProposalsService({
    store,
    proposals: createProposals(store, journal),
    uidValidity: async () => (await mails.position("inbox"))?.uidValidity ?? null,
    // ADR-0016: each mail is read where it is now.
    readMails: (uids, v) => readMailsForModelAt(locator, mail, password, uids, v),
    readTargets: (uids, v) => readReplyTargetsAt(locator, mail, password, uids, v),
    trames: loadTrames(),
    now: () => new Date(),
    sign: (p, now) => signProposal(acceptKey, p, now),
    undoMs: mail.undoMs,
    sending: mail.sending,
  }),
});

serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
  console.log(`Cénacle API listening on http://${HOST}:${info.port}`);
  console.log(
    `Page (jeton valable jusqu'à l'arrêt du serveur) : http://${HOST}:5173/#jeton=${token}`,
  );
});
