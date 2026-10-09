/**
 * Starts the API on 127.0.0.1 only. Usage: npm run server
 * A new token is drawn at each start. It is never printed (under launchd the
 * console is a log): the page's link is written to a file only I can read,
 * and `npm run page` opens it (ADR-0019). Signs my acceptances with the
 * private key of .env.page, loaded by this program only (ADR-0013).
 */
import { homedir } from "node:os";
import { privateKeyFromEnv, refuseForeignSecrets } from "@cenacle/core";
import {
  connectAsApp,
  createJournal,
  createLocationStore,
  createMailStore,
  createProposalStore,
  holdSingleInstance,
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
import { pageUrl, pageUrlPath, removePageUrl, writePageUrl } from "./page-url.ts";
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
// One server at a time (ADR-0019): a second one would fail on the port, or
// worse, replace the page's link with a token the running server never drew.
const lockSql = connectAsApp();
const instance = await holdSingleInstance(lockSql, "server");
if (instance === null) {
  console.error("🛑 Un autre serveur de la page tourne déjà : celui-ci ne démarre pas.");
  await Promise.all([lockSql.end(), sql.end()]);
  process.exit(75);
}
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

const linkPath = pageUrlPath(homedir());
const link = pageUrl(token);
const server = serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
  // Written only once the port is ours: a server that failed to listen never
  // replaces the link of the one that runs.
  writePageUrl(linkPath, link);
  console.log(`Cénacle API listening on http://${HOST}:${info.port}`);
  console.log("Page : lien prêt (valable jusqu'à l'arrêt du serveur) — ouvre-la avec npm run page");
});

// Ctrl+C, or SIGTERM when macOS logs out or launchd unloads the server: a
// clean stop, whose link no longer works, is removed.
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    removePageUrl(linkPath, link);
    server.close();
    await instance.release();
    await Promise.all([lockSql.end({ timeout: 2 }), sql.end({ timeout: 2 })]);
    process.exit(0);
  });
}
