/**
 * Starts the API on 127.0.0.1 only. Usage: npm run server
 * A new token is drawn at each start. It is never printed (under launchd the
 * console is a log): the page's link is written to a file only I can read,
 * and `npm run page` opens it (ADR-0019). Signs my acceptances with the
 * private key of .env.page, loaded by this program only (ADR-0013).
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createAgenda, loadAgendaConfig, send } from "@cenacle/agenda";
import { privateKeyFromEnv, refuseForeignSecrets } from "@cenacle/core";
import { askCtoService, ctoSocketPath } from "@cenacle/cto";
import {
  connectOrQuit,
  createJournal,
  createLocationStore,
  createMailStore,
  createParcStore,
  createProposalStore,
  createProspectionStore,
  holdOrQuit,
  waitForDatabase,
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
import { loadProspectionConfig } from "@cenacle/prospection";
import { parseRondeSource, RONDE_BULLETINS_PATH, RONDE_SOURCES } from "@cenacle/securite";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { defaultGuardConfig, newToken } from "./guard.ts";
import { createMachines } from "./machines.ts";
import { builtPageProblem } from "./page-files.ts";
import { pageUrl, pageUrlPath, removePageUrl, writePageUrl } from "./page-url.ts";
import { createParc, verdictFile } from "./parc.ts";
import { createProposalsService } from "./proposals-service.ts";
import { createProspectionService } from "./prospection-service.ts";
import { createProxmox, getJson, proxmoxConfig } from "./proxmox.ts";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CENACLE_API_PORT ?? 8787);
// The built page, served here (ADR-0037); CENACLE_WEB_DEV=1: Vite's dev server serves it instead.
const WEB_DEV = process.env.CENACLE_WEB_DEV === "1";
if (WEB_DEV) {
  console.error("⚠ Mode développement : la page n'est pas servie ici, l'origine 5173 peut agir.");
}
const WEB_DIR = join(import.meta.dirname, "..", "..", "web");
const SECURITE_TOML = join(import.meta.dirname, "..", "..", "..", "securite.toml");
/** The agenda's accounts (ADR-0042), git-ignored, read again at each reading. */
const AGENDA_TOML = join(import.meta.dirname, "..", "..", "..", "agenda.local.toml");
/** securite.toml's [ronde] source; a file that cannot be read names none. */
const rondeSource = () => {
  try {
    return parseRondeSource(readFileSync(SECURITE_TOML, "utf8"));
  } catch {
    return null;
  }
};
const pageProblem = WEB_DEV ? null : builtPageProblem(WEB_DIR);
if (pageProblem !== null) {
  // Never two versions: a page built from other sources is not served (point 3).
  console.error(`🛑 ${pageProblem} — le serveur ne démarre pas.`);
  process.exit(1);
}

const sql = await waitForDatabase(connectOrQuit());
const journal = createJournal(sql);
const store = createProposalStore(sql);
const board = createProspectionStore(sql);
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
refuseForeignSecrets("The page's server", ["mail", "page", "proxmox", "agenda"]);
// One server at a time (ADR-0019): a second one would fail on the port, or
// worse, replace the page's link with a token the running server never drew.
const lockSql = connectOrQuit("lock");
// One at a time; for a program that lives, the lock is watched (ADR-0023).
const instance = await holdOrQuit(
  lockSql,
  sql,
  "server",
  "Un autre serveur de la page tourne déjà : celui-ci ne démarre pas.",
  "Le serveur de la page",
);
const token = newToken();
const acceptKey = privateKeyFromEnv();

const app = createApp({
  readAfter: (agent, afterId) => journal.read({ agent, afterId, limit: 1000 }),
  guard: defaultGuardConfig(token, PORT, { devPage: WEB_DEV }),
  ...(WEB_DEV ? {} : { page: { dist: join(WEB_DIR, "dist") } }),
  parc: createParc({
    store: createParcStore(sql),
    // The ronde securite.toml names (ADR-0040, R3), read again at each request.
    source: rondeSource,
    readVerdict: (source) => verdictFile(RONDE_SOURCES[source].path)(),
    now: () => new Date(),
    // The ronde's file (ADR-0040): the page's server reads no machine itself.
    machines: createMachines({
      readFile: verdictFile(RONDE_BULLETINS_PATH),
      now: () => Date.now(),
    }),
    proxmox: createProxmox({
      config: () => proxmoxConfig(process.env),
      get: getJson,
      now: () => Date.now(),
    }),
  }),
  // The agenda (ADR-0042): read on demand from my calendars' servers, nothing kept.
  agenda: createAgenda({
    config: () => loadAgendaConfig(AGENDA_TOML, process.env),
    transport: (account, signal) => (request) =>
      send(
        request,
        { login: account.login, password: account.password ?? "", admitted: account.admitted },
        { signal },
      ),
    now: () => Date.now(),
    log: (line) => console.error(line),
  }),
  prospection: createProspectionService({
    store: board,
    config: () => loadProspectionConfig(),
    journal,
  }),
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
  // The CTO holds no secret and runs apart (ADR-0017, ADR-0020): asked over his socket.
  askCto: (question) => askCtoService(ctoSocketPath(homedir()), question),
});

const linkPath = pageUrlPath(homedir());
const link = pageUrl(token, WEB_DEV ? 5173 : PORT);
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
