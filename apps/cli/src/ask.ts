/**
 * Asks Iris a question through the local model (milestone J7).
 * Usage: npm run ask -- "Qui es-tu ?"
 * Watch the page meanwhile: Iris works while the model thinks.
 */
import { askIris, createLocalModels, localModelConfigFromEnv } from "@cenacle/brain";
import { connectAsApp, createJournal } from "@cenacle/journal";
import { setupTracing } from "@cenacle/observability";

const question = process.argv.slice(2).join(" ").trim();
if (question === "") {
  console.error('Usage: npm run ask -- "your question"');
  process.exit(1);
}

const tracing = setupTracing("cenacle-cli");
const sql = connectAsApp();
try {
  const local = createLocalModels(localModelConfigFromEnv());
  console.log(`… Iris asks ${local.model.id} (local)`);
  const answer = await askIris({
    question,
    dataClass: "personal",
    journal: createJournal(sql),
    local,
  });
  console.log(`\n${answer.text}\n`);
  const reasoning =
    answer.reasoningTokens === null ? "" : `, of which ${answer.reasoningTokens} hidden reasoning`;
  console.log(
    `(${(answer.durationMs / 1000).toFixed(1)} s, ${answer.outputTokens} tokens generated${reasoning}, local model, nothing sent elsewhere)`,
  );
} catch (error) {
  console.error(`🤒 ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await sql.end();
  await tracing.shutdown();
}
