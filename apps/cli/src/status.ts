/**
 * Prints an agent's status, computed from the journal.
 * Usage: npm run status -- [agent]   (default: iris)
 */
import { errorText, ProjectionError, projectStatus } from "@cenacle/core";
import { connectAsApp, createJournal, readAllEvents } from "@cenacle/journal";

const agent = process.argv[2] ?? "iris";
const sql = connectAsApp();

try {
  const events = await readAllEvents(createJournal(sql), agent);
  const status = projectStatus(agent, events);
  const face = { resting: "😌", working: "⚙️ ", sick: "🤒" }[status.view.visual];
  console.log(
    `${face} ${agent}: ${status.view.visual}${status.view.note ? ` (${status.view.note})` : ""}`,
  );
  console.log(`   internal state : ${status.internal}`);
  console.log(`   since          : ${status.since?.toISOString() ?? "—"}`);
  console.log(`   💬 pending     : ${status.pendingApprovals}`);
  if (status.mail !== null) {
    const m = status.mail;
    console.log(
      `   📬 mail        : clients ${m.clients_prospects}, admin ${m.administratif}, bruit ${m.bruit}, à trier ${m.a_trier}, pending ${m.pending} — 🔔 due ${m.due}, ⏳ waiting ${m.waiting}`,
    );
  }
  console.log(`   events applied : ${events.length}`);
} catch (error) {
  if (error instanceof ProjectionError) {
    console.error(
      `🛑 Cannot compute the status of ${agent}: ${errorText(error, [ProjectionError])}`,
    );
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await sql.end();
}
