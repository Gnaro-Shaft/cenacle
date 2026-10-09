/**
 * Ask the CTO a technical question (phase 6 — ADR-0017, ADR-0020).
 * Usage: npm run cto -- "ta question"
 *
 * Through the CTO's service when it runs (one question at a time on the shared
 * model); on its own otherwise, with the same checked answer. He holds no
 * secret: he refuses to start if any secret family is loaded. Neither the
 * question nor the answer is kept: the journal gets counts only.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { ModelUnavailableError } from "@cenacle/brain";
import { refuseForeignSecrets } from "@cenacle/core";
import {
  askCto,
  askCtoService,
  type CtoProgress,
  type CtoReply,
  CtoServiceError,
  ctoModels,
  ctoSocketPath,
  QuestionError,
  validQuestion,
} from "@cenacle/cto";
import { connectAsApp, createJournal } from "@cenacle/journal";

const ROOT = join(import.meta.dirname, "..", "..", "..");
// The CTO reads documentation, never mail: no secret family at all (ADR-0017).
refuseForeignSecrets("Le CTO", []);

/**
 * One status line on the terminal, rewritten in place: waiting in line,
 * reading, writing. Counts only, never the text. Off when the output is not a
 * terminal (a log keeps only the answer).
 */
function statusLine() {
  const tty = process.stderr.isTTY === true;
  const write = (text: string) => {
    if (tty) process.stderr.write(`\r\x1b[K${text}`);
  };
  return {
    show: (p: CtoProgress) => {
      if (p.kind === "queued") write(`⏳ ${p.ahead} question(s) avant la tienne…`);
      if (p.kind === "reading") write(`📖 ${p.phase} : lecture de la documentation…`);
      if (p.kind === "writing") {
        write(`✍️  ${p.phase} : ${p.chars.toLocaleString("fr-FR")} caractères écrits…`);
      }
      if (p.kind === "revising") {
        write("");
        console.log(
          `🔎 Premier jet : ${p.missing} référence(s) introuvable(s) dans le dépôt — le CTO corrige sa réponse…`,
        );
      }
    },
    clear: () => write(""),
  };
}

async function alone(question: string, show: (p: CtoProgress) => void): Promise<CtoReply> {
  const sql = connectAsApp();
  try {
    return await askCto(question, {
      root: ROOT,
      journal: createJournal(sql),
      local: ctoModels(),
      onProgress: show,
    });
  } finally {
    await sql.end();
  }
}

const status = statusLine();
try {
  const question = validQuestion(process.argv.slice(2).join(" "));
  let reply: CtoReply;
  try {
    reply = await askCtoService(ctoSocketPath(homedir()), question, { onProgress: status.show });
  } catch (error) {
    if (!(error instanceof CtoServiceError) || error.code !== "unreachable") throw error;
    console.log("(service du CTO absent : il répond seul)\n");
    reply = await alone(question, status.show);
  }
  status.clear();
  console.log(reply.text);
  if (reply.cut) {
    console.log(
      "\n⚠ Réponse coupée à la limite de longueur : demande-lui d'approfondir un point précis.",
    );
  }
  console.log(`\n${reply.summary}`);
  console.log(
    `— ${reply.seconds} s, ${reply.documents} documents, modèle local. Un avis à vérifier, pas un fait établi.`,
  );
} catch (error) {
  status.clear();
  if (error instanceof QuestionError) {
    console.error(`usage : npm run cto -- "ta question" (${error.message})`);
  } else if (
    error instanceof ModelUnavailableError ||
    (error instanceof CtoServiceError && error.code === "model_unavailable")
  ) {
    console.error(
      "🛑 le modèle local ne répond pas : LM Studio est-il ouvert, avec le modèle chargé ?",
    );
  } else if (error instanceof CtoServiceError) {
    console.error(`🛑 ${error.message}`);
  } else {
    console.error(`🛑 ${error instanceof Error ? error.name : "erreur"}`);
  }
  process.exitCode = 1;
}
