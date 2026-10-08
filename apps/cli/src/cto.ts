/**
 * Ask the CTO a technical question (phase 6, J1 — ADR-0017).
 * Usage: npm run cto -- "ta question"
 *
 * The CTO answers from the versioned documentation of Cénacle, chosen by code,
 * with the local model only. He holds no secret: he refuses to start if any
 * secret family is loaded. Neither the question nor the answer is kept: the
 * journal gets facts and counts under the agent "cto", as for Iris.
 */
import { join } from "node:path";
import {
  askAgent,
  createLocalModels,
  localModelConfigFromEnv,
  ModelUnavailableError,
} from "@cenacle/brain";
import { refuseForeignSecrets } from "@cenacle/core";
import {
  answerVerified,
  buildRepoIndex,
  checkSummary,
  ctoSystemPrompt,
  loadProjectContext,
} from "@cenacle/cto";
import { connectAsApp, createJournal } from "@cenacle/journal";

const ROOT = join(import.meta.dirname, "..", "..", "..");
// The CTO reads documentation, never mail: no secret family at all (ADR-0017).
refuseForeignSecrets("Le CTO", []);
const question = process.argv.slice(2).join(" ").trim();
if (question === "") {
  console.error('usage : npm run cto -- "ta question"');
  process.exit(1);
}
const sql = connectAsApp();
try {
  const context = loadProjectContext(ROOT);
  console.log(
    `📚 ${context.files.length} documents lus (${Math.round(context.chars / 1000)} k caractères)${
      context.skipped.length > 0 ? `, ${context.skipped.length} écartés` : ""
    } — le CTO réfléchit…\n`,
  );
  const journal = createJournal(sql);
  const system = ctoSystemPrompt("Cénacle", context);
  // 120 k characters of documentation are ~35 k tokens: a window far above
  // Iris's, within what LM Studio loads for the shared model (208 k).
  const local = createLocalModels({
    ...localModelConfigFromEnv(),
    contextWindow: 131_072,
    maxTokens: 4096,
  });
  const started = Date.now();
  // Checked before shown (ADR-0017): every ADR, file, command and name the answer
  // cites is looked up in the repository; what cannot be found goes back once.
  const answer = await answerVerified(
    question,
    async (prompt) =>
      (
        await askAgent({
          agent: "cto",
          systemPrompt: system,
          question: prompt,
          // The question may name someone: local model only (ADR-0003).
          dataClass: "personal",
          journal,
          local,
          timeoutMs: 300_000,
        })
      ).text,
    buildRepoIndex(ROOT),
  );
  await journal.append({
    agent: "cto",
    type: "cto.verified",
    payload: {
      claims: answer.checked.length,
      notFound: answer.checked.filter((c) => !c.found).length,
      revised: answer.revised,
      notFoundFirst: answer.unverifiedFirst.length,
    },
  });
  console.log(answer.text);
  console.log(`\n${checkSummary(answer)}`);
  console.log(
    `— ${Math.round((Date.now() - started) / 1000)} s, modèle local. Un avis à vérifier, pas un fait établi.`,
  );
} catch (error) {
  if (error instanceof ModelUnavailableError) {
    console.error(
      "🛑 le modèle local ne répond pas : LM Studio est-il ouvert, avec le modèle chargé ?",
    );
  } else {
    console.error(`🛑 ${error instanceof Error ? error.name : "erreur"}`);
  }
  process.exitCode = 1;
} finally {
  await sql.end();
}
