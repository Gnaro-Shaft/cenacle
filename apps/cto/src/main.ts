/**
 * The CTO's service (phase 6, J2 — ADR-0020). Usage: npm run cto:serve
 * (under launchd: npm run service -- install cto).
 *
 * Answers the page and `npm run cto` on a local socket only I can open, one
 * question at a time. Holds no secret (ADR-0017): it refuses to start if any
 * secret family is loaded. Nothing is kept: the journal gets counts only.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { refuseForeignSecrets } from "@cenacle/core";
import { askCto, createCtoService, ctoModels, ctoSocketPath, listenCto } from "@cenacle/cto";
import { connectAsApp, createJournal, holdSingleInstance } from "@cenacle/journal";

const ROOT = join(import.meta.dirname, "..", "..", "..");
// The CTO reads documentation, never mail: no secret family at all (ADR-0017).
refuseForeignSecrets("Le CTO", []);
const sql = connectAsApp();
// One service at a time: a second one would take over the socket of the first.
const lockSql = connectAsApp();
const instance = await holdSingleInstance(lockSql, "cto");
if (instance === null) {
  console.error("🛑 Un autre service du CTO tourne déjà : celui-ci ne démarre pas.");
  await Promise.all([lockSql.end(), sql.end()]);
  process.exit(75);
}
const journal = createJournal(sql);
const local = ctoModels();
const service = createCtoService({
  ask: (question, onProgress) => askCto(question, { root: ROOT, journal, local, onProgress }),
});
const listener = await listenCto(ctoSocketPath(homedir()), service);
console.log("Le CTO écoute sur sa prise locale (une question à la fois).");

// Ctrl+C, or SIGTERM when macOS logs out or launchd unloads it: a clean stop.
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await listener.close();
    await instance.release();
    await Promise.all([lockSql.end({ timeout: 2 }), sql.end({ timeout: 2 })]);
    process.exit(0);
  });
}
