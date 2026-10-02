/**
 * Prints an agent's status, computed from the journal.
 * Usage: npm run status -- [agent]   (default: iris)
 */
import { type AgentEvent, ProjectionError, projectStatus } from "@cenacle/core";
import { connectAsApp, createJournal } from "@cenacle/journal";

const PAGE = 1000;
const agent = process.argv[2] ?? "iris";
const sql = connectAsApp();

try {
  const journal = createJournal(sql);
  const events: AgentEvent[] = [];
  let afterId = 0n;
  for (;;) {
    const page = await journal.read({ agent, afterId, limit: PAGE });
    events.push(...page);
    const last = page.at(-1);
    if (last === undefined || page.length < PAGE) break;
    afterId = last.id;
  }

  const status = projectStatus(agent, events);
  const face = { resting: "😌", working: "⚙️ ", sick: "🤒" }[status.view.visual];
  console.log(
    `${face} ${agent}: ${status.view.visual}${status.view.note ? ` (${status.view.note})` : ""}`,
  );
  console.log(`   internal state : ${status.internal}`);
  console.log(`   since          : ${status.since?.toISOString() ?? "—"}`);
  console.log(`   💬 pending     : ${status.pendingApprovals}`);
  console.log(`   events applied : ${events.length}`);
} catch (error) {
  if (error instanceof ProjectionError) {
    console.error(`🛑 Cannot compute the status of ${agent}: ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await sql.end();
}
