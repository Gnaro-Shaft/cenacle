/**
 * The liaison with the house (ADR-0048): the only program that holds the key
 * to the house's VM. launchd starts it every minute; one pass at a time. It
 * hands over the demands I accepted on the page, reads where they are, and
 * purges what its retentions say. It holds the Telegram token to tell me, and
 * no other secret: the page's public key is not one (.env), and its key is a
 * file of mine, readable by me only, named in liaison.local.toml. No model.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  errorText,
  publicKeyFromEnv,
  refuseForeignSecrets,
  UsageError,
  verifierLiaison,
} from "@cenacle/core";
import {
  connectOrQuit,
  createJournal,
  createLiaisonDemandes,
  createLiaisonEtats,
  holdSingleInstance,
  latestEventAt,
  waitForDatabase,
} from "@cenacle/journal";
import { loadCadre } from "@cenacle/mail";
import {
  LIAISON_CONFIG_FILE,
  LIAISON_SWITCH_FILE,
  LiaisonConfigError,
  parseLiaisonDossiers,
  parseLiaisonPorte,
  parseLiaisonSwitch,
} from "@cenacle/securite";
import { createTelegramApi } from "@cenacle/telegram/api";
import { AGENT, transmettre } from "./depot.ts";
import { ETAT_INTERVALLE_MS, relever } from "./etat.ts";
import { MAX_DEPOT, MAX_ETAT } from "./reponse.ts";
import { appeler, keyIsPrivate, sshArgs } from "./ssh.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const JOUR_MS = 86_400_000;

refuseForeignSecrets("La liaison", ["telegram"]);

const read = (name: string): string | null => {
  const path = join(ROOT, name);
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
};

/** Everything a pass needs, or the reason it cannot run — said, never a silent pass. */
function config() {
  const text = read(LIAISON_CONFIG_FILE);
  if (text === null) throw new UsageError(`${LIAISON_CONFIG_FILE} absent (voir l'exemple)`);
  try {
    const porte = parseLiaisonPorte(text);
    const dossiers = parseLiaisonDossiers(text);
    if (!keyIsPrivate(porte.cle)) {
      throw new UsageError("la clé de la liaison est absente, ou lisible par un autre que moi");
    }
    if (!existsSync(porte.knownHosts)) {
      throw new UsageError("le known_hosts de la liaison est absent : épingler la VM d'abord");
    }
    return { porte, dossiers };
  } catch (e) {
    // Its kind only: the message never quotes a value of the file.
    if (e instanceof LiaisonConfigError) {
      throw new UsageError(
        `${LIAISON_CONFIG_FILE} refusé (${e.problem}) : npm run liaison:verifier`,
      );
    }
    throw e;
  }
}

function retentions() {
  const c = loadCadre().conservation;
  if (c.liaisonTexteJours === undefined || c.liaisonJours === undefined) {
    throw new UsageError("[conservation] liaison_texte_jours et liaison_jours manquent au cadre");
  }
  return { texte: c.liaisonTexteJours, ligne: c.liaisonJours };
}

async function pass(sql: ReturnType<typeof connectOrQuit>): Promise<void> {
  const { porte, dossiers } = config();
  const jours = retentions();
  const publicKey = publicKeyFromEnv();
  const chatId = Number(process.env.TELEGRAM_ALLOWED_CHAT_ID);
  if (!Number.isSafeInteger(chatId) || chatId === 0) {
    throw new UsageError("TELEGRAM_ALLOWED_CHAT_ID is missing or not a number (see .env.example)");
  }
  const telegram = createTelegramApi(process.env.TELEGRAM_BOT_TOKEN ?? "");
  const send = (text: string) => telegram.sendMessage(chatId, text);
  const demandes = createLiaisonDemandes(sql);
  const etats = createLiaisonEtats(sql);
  const journal = createJournal(sql);
  const now = () => new Date();

  const depot = await transmettre({
    demandes,
    signee: (d) =>
      d.decideLe !== null &&
      d.titre !== null &&
      d.description !== null &&
      verifierLiaison(
        publicKey,
        { ...d, titre: d.titre, description: d.description, decideLe: d.decideLe },
        d.signature,
      ),
    dossiers,
    deposer: (json) => appeler(sshArgs(porte, "deposer"), json, MAX_DEPOT),
    journal,
    send,
    plafondDitLe: () => latestEventAt(sql, AGENT, "liaison.plafond"),
    now,
  });

  const etat = await relever({
    etats,
    lire: () => appeler(sshArgs(porte, "etat"), "", MAX_ETAT),
    aLire: async () => {
      const last = await latestEventAt(sql, AGENT, "liaison.etat");
      if (last !== null && Date.now() - last.getTime() < ETAT_INTERVALLE_MS) return false;
      const recentes = await demandes.transmisesDepuis(new Date(Date.now() - 30 * JOUR_MS));
      return recentes > 0 || (await etats.all()).length > 0;
    },
    demandeDu: (ticket) => demandes.idDuTicket(ticket),
    journal,
    send,
    now,
  });

  const purge = await demandes.purge(
    new Date(Date.now() - jours.texte * JOUR_MS),
    new Date(Date.now() - jours.ligne * JOUR_MS),
  );
  if (purge.textes + purge.lignes > 0) {
    await journal.append({ agent: AGENT, type: "liaison.purges", payload: { ...purge } });
  }
  const moved = depot.transmises + depot.echouees + depot.refusees + depot.caduques;
  if (moved > 0 || (etat.lu && etat.ok && etat.annoncees > 0)) {
    console.log(
      `✔ Liaison : ${depot.transmises} transmise(s), ${depot.echouees} échouée(s), ` +
        `${depot.refusees} refusée(s), ${depot.caduques} caduque(s)` +
        (etat.lu && etat.ok ? `, ${etat.annoncees} PR annoncée(s)` : ""),
    );
  }
  if (etat.lu && !etat.ok) console.error(`⚠️ Liaison : état non lu (${etat.categorie}).`);
}

const interrupteur = parseLiaisonSwitch(read(LIAISON_SWITCH_FILE));
if (interrupteur === "illisible") {
  console.error(
    `🛑 Liaison coupée : ${LIAISON_SWITCH_FILE} est illisible (actif = true ou false).`,
  );
  process.exitCode = 78;
} else if (interrupteur === "actif") {
  const sql = await waitForDatabase(connectOrQuit());
  const lockSql = connectOrQuit("lock");
  let instance: Awaited<ReturnType<typeof holdSingleInstance>> = null;
  try {
    instance = await holdSingleInstance(lockSql, "liaison");
    if (instance === null) {
      console.error("🛑 Un autre passage de la liaison tourne déjà : celui-ci ne fait rien.");
      process.exitCode = 75;
    } else await pass(sql);
  } catch (error) {
    console.error(`🛑 ${errorText(error, [UsageError])}`);
    process.exitCode = 1;
  } finally {
    await instance?.release();
    await Promise.all([lockSql.end(), sql.end()]);
  }
}
