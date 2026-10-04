/**
 * The executor (phase 4, B4). Usage: npm run executor
 * A separate program from Iris: it has no model and can only send what I
 * accepted, after the 2-minute undo delay, to the test server of this
 * machine. Every 10 seconds; /stop on Telegram or Ctrl+C ends it.
 * It holds the page's public key: it can check an acceptance, never make one.
 */
import { dayStart, heartbeatFromEnv, publicKeyFromEnv, refuseForeignSecrets } from "@cenacle/core";
import {
  connectAsExecutor,
  createJournal,
  createMailStore,
  createProposalStore,
  readAllEvents,
} from "@cenacle/journal";
import {
  buildReply,
  copyToSent,
  createProposals,
  fetchSentRefs,
  isAcceptedByPage,
  keyerFromEnv,
  loadCadre,
  readReplyContexts,
  sendReply,
  testMailboxConfigFromEnv,
} from "@cenacle/mail";
import { executeDue, MAX_SENDS_PER_DAY } from "./execute.ts";

const ROUND_MS = 10_000;
refuseForeignSecrets("The executor", ["mail", "executor", "sentinel"]);
const acceptKey = publicKeyFromEnv();
// Its own database role: the only one allowed to claim and close a sending (B7).
const sql = connectAsExecutor();
const journal = createJournal(sql);
const store = createProposalStore(sql);
const mails = createMailStore(sql);
const keyer = keyerFromEnv();
const { mail: cadre } = loadCadre();
const { password } = testMailboxConfigFromEnv();
const startedAt = new Date();
// S2: the sentinel hears the executor once a minute at most.
const sentinel = heartbeatFromEnv("executor");
let lastBeat = 0;
let sentinelDown = false;
if (sentinel === null)
  console.log(
    "ℹ Sentinelle non configurée (CENACLE_SENTINEL_URL absent) : aucun battement envoyé.",
  );
const LAPSE = {
  gone: "le mail n'est plus là",
  answered: "tu as déjà répondu",
  no_recipient: "adresse illisible",
};

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});

let limitedDay: string | null = null;
console.log(
  `Exécuteur prêt : envoie ce que tu as accepté, après 2 min, vers ${cadre.host}:${cadre.smtpPort} (test), ${MAX_SENDS_PER_DAY}/jour au plus.`,
);
while (!stopping) {
  try {
    const stop = (await readAllEvents(journal, "cenacle")).findLast(
      (e) => e.type === "stop.requested",
    );
    if (stop !== undefined && stop.occurredAt.getTime() > startedAt.getTime()) {
      console.log("🛑 Arrêt d'urgence demandé sur Telegram : l'exécuteur s'arrête.");
      break;
    }
    if (sentinel !== null && Date.now() - lastBeat >= 60_000) {
      lastBeat = Date.now();
      const ok = await sentinel.beat();
      if (!ok && !sentinelDown) console.error("⚠ Sentinelle injoignable : battement non reçu");
      sentinelDown = !ok;
    }
    const r = await executeDue({
      store,
      proposals: createProposals(store, journal),
      journal,
      now: () => new Date(),
      mailOf: async (p) => {
        const position = await mails.position("inbox");
        if (position?.uidValidity !== p.mailUidValidity) return null;
        return (await mails.inbox()).find((m) => m.uid === p.mailUid) ?? null;
      },
      freshSent: async () => [
        ...(await mails.sent()),
        ...(await fetchSentRefs(cadre, password, keyer)).refs,
      ],
      context: async (p) =>
        (await readReplyContexts(cadre, password, [p.mailUid], p.mailUidValidity)).get(p.mailUid),
      build: (context, text, date) => buildReply(cadre.address, context, text, date),
      send: (reply) => sendReply(cadre, password, reply),
      copy: (reply) => copyToSent(cadre, password, reply.raw),
      verify: (p) => isAcceptedByPage(acceptKey, p),
    });
    for (const id of r.sent) console.log(`📤 ${id} envoyé`);
    for (const id of r.failed)
      console.log(`❌ ${id} : échec de l'envoi — non réessayé, voir la page`);
    for (const id of r.unsigned)
      console.log(`🛑 ${id} : acceptée sans la signature de la page — non envoyée, voir la page`);
    for (const l of r.lapsed) console.log(`🗑 ${l.id} caduc : ${LAPSE[l.reason]}`);
    const today = dayStart(new Date()).toISOString();
    if (r.limited && limitedDay !== today) {
      limitedDay = today;
      await journal.append({
        agent: "iris",
        type: "send.limit_reached",
        payload: { limit: MAX_SENDS_PER_DAY },
      });
      console.log(`⏸ ${MAX_SENDS_PER_DAY} envois aujourd'hui : le reste attend demain`);
    }
  } catch (error) {
    // The name only: an error message may quote an address.
    console.error(`⚠ ${error instanceof Error ? error.name : "error"} — nouvel essai dans 10 s`);
  }
  for (let s = 0; s < ROUND_MS / 1000 && !stopping; s++)
    await new Promise((r) => setTimeout(r, 1000));
}
await sql.end();
