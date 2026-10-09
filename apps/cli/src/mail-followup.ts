/**
 * Which client and prospect mails still wait for my reply (phase 3, S2).
 * Reads Iris's memory only — no mailbox, no model.
 * Usage: npm run mail:followup [-- --at 2026-10-01T10:00:00+02:00]
 */
import { countFollowUps, errorText, FOLLOW_UP_HOURS, UsageError } from "@cenacle/core";
import { connectOrQuit, createMailStore } from "@cenacle/journal";

const atIndex = process.argv.indexOf("--at");
const now = atIndex === -1 ? new Date() : new Date(process.argv[atIndex + 1] ?? "");
const sql = connectOrQuit();
try {
  if (Number.isNaN(now.getTime()))
    throw new UsageError("--at needs a date, e.g. 2026-10-01T10:00:00+02:00");
  const store = createMailStore(sql);
  const counts = countFollowUps(await store.inbox(), await store.sent(), now);
  console.log(`Suivi au ${now.toISOString()} (relance après ${FOLLOW_UP_HOURS} h ouvrées) :`);
  console.log(`  ✔ répondus          ${counts.replied}`);
  console.log(`  ⏳ en attente        ${counts.waiting}`);
  console.log(`  🔔 relances dues     ${counts.due}`);
  console.log(`  · non suivis        ${counts.not_tracked}`);
} catch (error) {
  console.error(`🛑 ${errorText(error)}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
