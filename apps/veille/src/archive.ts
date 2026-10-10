/**
 * Reuse my veille (J5, ADR-0024). Usage:
 *   npm run veille:archive -- [--depuis AAAA-MM-JJ] [--projet <nom>] [--cherche <mots>] [--max <n>]
 * Prints the articles I received, as Markdown, newest first. Reads only: it
 * holds no secret and changes nothing.
 */
import { errorText, refuseForeignSecrets, UsageError } from "@cenacle/core";
import { archiveMarkdown } from "@cenacle/cto/veille";
import { connectOrQuit, createVeilleStore } from "@cenacle/journal";

const USAGE =
  "usage : npm run veille:archive -- [--depuis AAAA-MM-JJ] [--projet <nom>] [--cherche <mots>] [--max <n>]";

function options(args: readonly string[]) {
  const out: { since?: string; project?: string; text?: string; max?: number } = {};
  for (let i = 0; i < args.length; i += 2) {
    const [flag, value] = [args[i], args[i + 1]];
    if (value === undefined || value.trim() === "") throw new UsageError(USAGE);
    if (flag === "--depuis" && /^\d{4}-\d{2}-\d{2}$/.test(value)) out.since = value;
    else if (flag === "--projet" && value.length <= 40) out.project = value;
    else if (flag === "--cherche" && value.length <= 100) out.text = value;
    else if (flag === "--max" && /^\d{1,3}$/.test(value)) out.max = Number(value);
    else throw new UsageError(USAGE);
  }
  return out;
}

refuseForeignSecrets("L'archive de la veille", []);
const sql = connectOrQuit();
try {
  const o = options(process.argv.slice(2));
  const since = o.since === undefined ? undefined : new Date(`${o.since}T00:00:00`);
  if (since !== undefined && Number.isNaN(since.getTime())) throw new UsageError(USAGE);
  const articles = await createVeilleStore(sql).search({
    ...(since === undefined ? {} : { since }),
    ...(o.project === undefined ? {} : { project: o.project }),
    ...(o.text === undefined ? {} : { text: o.text }),
    ...(o.max === undefined ? {} : { limit: o.max }),
  });
  console.log(archiveMarkdown(articles, o));
} catch (error) {
  console.error(`🛑 ${errorText(error, [UsageError])}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
