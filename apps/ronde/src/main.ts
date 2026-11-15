/**
 * The ronde (ADR-0040, R2): launchd starts it every 5 minutes; one pass at a
 * time (the instance lock). It reads each machine's bulletin with its
 * read-only key, judges it with Legion's rules, and leaves two files on the
 * Mac, written whole and overwritten at every pass: the verdict, in Legion's
 * format, and the last measures for the page. No secret, no message, no
 * model: the security agent and the page read what it leaves.
 */
import { join } from "node:path";
import { errorText, refuseForeignSecrets } from "@cenacle/core";
import { connectOrQuit, holdSingleInstance } from "@cenacle/journal";
import {
  PARK_FILE,
  RONDE_BULLETINS_PATH,
  RONDE_VERDICT_PATH,
  verdictText,
  worstState,
} from "@cenacle/securite";
import { readOrNull, writeWhole } from "./files.ts";
import { runPass } from "./pass.ts";
import { keyIsPrivate, runSsh } from "./ssh.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");

refuseForeignSecrets("La ronde", []);

async function pass(): Promise<void> {
  const before = readOrNull(RONDE_VERDICT_PATH)?.match(/^etat=(\w+)$/m)?.[1] ?? null;
  const result = await runPass({
    readConfig: () => readOrNull(join(ROOT, PARK_FILE)),
    run: runSsh,
    keyOk: (path) => keyIsPrivate(path),
    now: () => Date.now(),
  });
  // The page's file first: it says, even with no machine, why none is read.
  writeWhole(RONDE_BULLETINS_PATH, `${JSON.stringify(result.bulletins)}\n`);
  for (const note of result.notes) console.log(`ℹ Ronde : ${note}`);
  if (result.hosts.length === 0) return;
  writeWhole(RONDE_VERDICT_PATH, verdictText(result.hosts, Math.floor(Date.now() / 1000)));
  // One line when the state changes, not one every 5 minutes.
  const state = worstState(result.hosts.map((h) => h.state));
  if (state !== before) {
    console.log(`✔ Ronde : ${state} (${result.hosts.length} machine(s), était ${before ?? "—"})`);
  }
}

const lockSql = connectOrQuit("lock");
let instance: Awaited<ReturnType<typeof holdSingleInstance>> = null;
try {
  instance = await holdSingleInstance(lockSql, "ronde");
  if (instance === null) {
    console.error("🛑 Un autre passage de la ronde tourne déjà : celui-ci ne fait rien.");
    process.exitCode = 75;
  } else await pass();
} catch (error) {
  console.error(`🛑 ${errorText(error)}`);
  process.exitCode = 1;
} finally {
  await instance?.release();
  await lockSql.end();
}
