/**
 * The executor (phase 4, B4). Usage: npm run executor
 * A separate program from Iris: it has no model and can only send what I
 * accepted, after the 2-minute undo delay, to the test server of this
 * machine. Every 10 seconds; /stop on Telegram or Ctrl+C ends it.
 * It holds the page's public key: it can check an acceptance, never make one.
 */
import {
  dayStart,
  errorText,
  heartbeatFromEnv,
  publicKeyFromEnv,
  refuseForeignSecrets,
} from "@cenacle/core";
import {
  connectOrQuit,
  createJournal,
  createLocationStore,
  createMailStore,
  createProposalStore,
  readAllEvents,
} from "@cenacle/journal";
import {
  buildReply,
  copyToSent,
  createLocator,
  createProposals,
  fetchSentRefs,
  isAcceptedByPage,
  keyerFromEnv,
  loadCadre,
  mailPassword,
  ReadOnlyMailboxError,
  readReplyContextsAt,
  senderAuthFor,
  sendReply,
  storedVerdict,
} from "@cenacle/mail";
import { executeDue } from "./execute.ts";

const ROUND_MS = 10_000;
refuseForeignSecrets("The executor", ["mail", "executor", "sentinel"]);
// M2: a real box sends nothing until [ouverture] — the executor does not even start (sendReply refuses too).
if (loadCadre().mail.sending === "none") {
  console.error(
    `🛑 ${errorText(new ReadOnlyMailboxError("Starting the executor"), [ReadOnlyMailboxError])}`,
  );
  process.exit(1);
}
const acceptKey = publicKeyFromEnv();
// Its own database role: the only one allowed to claim and close a sending (B7).
const sql = connectOrQuit("executor");
const journal = createJournal(sql);
const store = createProposalStore(sql);
const mails = createMailStore(sql);
// ADR-0016: where each remembered mail is now (read only: the executor moves nothing).
const locations = createLocationStore(sql);
const keyer = keyerFromEnv();
const { mail: cadre } = loadCadre();
const password = mailPassword(loadCadre());
// M3: on a real box, a sender must be authenticated before a send (ADR-0014's verdict, kept with the mail).
const senderAuth = senderAuthFor(cadre, storedVerdict(mails));
const locator = createLocator({ cadre, password, keyer, locations });
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
  unauthenticated: "expéditeur non authentifié",
};

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});

let limitedDay: string | null = null;
const TO = {
  none: "à personne",
  "test-domains": "vers des domaines de test seulement",
  closed: "vers ta liste fermée seulement",
  correspondents: "au vrai correspondant (expéditeur authentifié)",
} as const;
console.log(
  `Exécuteur prêt : envoie ce que tu as accepté, après ${cadre.undoMs / 60_000} min, ${TO[cadre.sending]}, ${cadre.maxPerDay}/jour au plus.`,
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
        (await readReplyContextsAt(locator, cadre, password, [p.mailUid], p.mailUidValidity)).get(
          p.mailUid,
        ),
      build: (context, text, date) => buildReply(cadre.address, context, text, date, cadre),
      send: (reply) => sendReply(cadre, password, reply),
      copy: (reply) => copyToSent(cadre, password, reply.raw),
      verify: (p) => isAcceptedByPage(acceptKey, p),
      maxPerDay: cadre.maxPerDay,
      undoMs: cadre.undoMs,
      authenticated: (p) => senderAuth(p.mailUid, p.mailUidValidity),
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
        payload: { limit: cadre.maxPerDay },
      });
      console.log(`⏸ ${cadre.maxPerDay} envois aujourd'hui : le reste attend demain`);
    }
  } catch (error) {
    // The name only: an error message may quote an address.
    console.error(`⚠ ${errorText(error)} — nouvel essai dans 10 s`);
  }
  for (let s = 0; s < ROUND_MS / 1000 && !stopping; s++)
    await new Promise((r) => setTimeout(r, 1000));
}
await sql.end();
