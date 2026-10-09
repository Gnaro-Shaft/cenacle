/**
 * Ask the CTO a technical question (phase 6 — ADR-0017, ADR-0020).
 * Usage: npm run cto -- "ta question"
 *        npm run cto -- --relire <branche locale>   (J3 — ADR-0021)
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
  askCtoReview,
  askCtoService,
  branchTarget,
  type CtoProgress,
  type CtoReply,
  CtoServiceError,
  ctoModels,
  ctoSocketPath,
  QuestionError,
  ReviewError,
  reviewCto,
  validBranch,
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
      if (p.kind === "tool") write(`🔍 ${p.tool} ${p.target}…`);
      if (p.kind === "pass") write(`📄 ${p.n}/${p.of} ${p.label}…`);
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

/** Without the service: the same circuit, in this process. */
async function alone(
  request: { question: string } | { review: string },
  show: (p: CtoProgress) => void,
): Promise<CtoReply> {
  const sql = connectAsApp();
  try {
    const deps = { root: ROOT, journal: createJournal(sql), local: ctoModels(), onProgress: show };
    return "review" in request
      ? await reviewCto(branchTarget(ROOT, request.review), deps)
      : await askCto(request.question, deps);
  } finally {
    await sql.end();
  }
}

const status = statusLine();
try {
  const args = process.argv.slice(2);
  const request =
    args[0] === "--relire"
      ? { review: validBranch(args[1]) }
      : { question: validQuestion(args.join(" ")) };
  if ("review" in request) console.log(`🧐 Relecture de ${request.review} (10 à 15 min)…\n`);
  const socket = ctoSocketPath(homedir());
  let reply: CtoReply;
  try {
    reply =
      "review" in request
        ? await askCtoReview(socket, request.review, { onProgress: status.show })
        : await askCtoService(socket, request.question, { onProgress: status.show });
  } catch (error) {
    if (!(error instanceof CtoServiceError) || error.code !== "unreachable") throw error;
    console.log("(service du CTO absent : il répond seul)\n");
    reply = await alone(request, status.show);
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
  if (error instanceof QuestionError || error instanceof ReviewError) {
    console.error(`usage : npm run cto -- "ta question" | --relire <branche> (${error.message})`);
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
