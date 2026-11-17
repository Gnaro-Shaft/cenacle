/**
 * The nightly copy of the base (ADR-0044): launchd starts it at 02:30 (a Mac
 * asleep then runs it when it wakes); one copy at a time (the instance lock).
 * It holds the copie family alone, and says one line: the copy pushed and its
 * size, or why nothing left. Never a path, never a value.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { errorText, refuseForeignSecrets } from "@cenacle/core";
import { COPIE_PASSWORD_VAR, connectOrQuit, holdSingleInstance } from "@cenacle/journal";
import { COPIE_FILE, pushKeyPath } from "./config.ts";
import { runCopie } from "./copie.ts";
import {
  CopieError,
  dumpEncrypted,
  findContainer,
  findTool,
  isRealRsync,
  TOOLS,
} from "./export.ts";
import { runPush } from "./pousser.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");

refuseForeignSecrets("La copie de la base", ["copie"]);

/** A regular file of mine, readable by me only (600 or 400): else the key is not used. */
function keyIsPrivate(path: string): boolean {
  try {
    const s = statSync(path);
    return s.isFile() && (s.mode & 0o077) === 0 && s.uid === process.getuid?.();
  } catch {
    return false;
  }
}

async function copy(): Promise<void> {
  const password = process.env[COPIE_PASSWORD_VAR] ?? "";
  if (password === "") {
    console.error(`🛑 ${COPIE_PASSWORD_VAR} manque (.env.copie) : aucune copie`);
    process.exitCode = 1;
    return;
  }
  const file = join(ROOT, COPIE_FILE);
  const result = await runCopie({
    readConfig: () => (existsSync(file) ? readFileSync(file, "utf8") : null),
    pushKey: pushKeyPath(homedir()),
    keyOk: keyIsPrivate,
    knownHostsOk: (path) => existsSync(path) && statSync(path).isFile(),
    tools: {
      docker: findTool(TOOLS.docker),
      age: findTool(TOOLS.age),
      rsync: findTool(TOOLS.rsync, isRealRsync),
    },
    container: (docker) => findContainer(docker, process.env.CENACLE_DB_PORT ?? "55432"),
    password,
    database: "cenacle",
    tmp: tmpdir(),
    dump: dumpEncrypted,
    push: runPush,
    now: () => new Date(),
  });
  console.log(`✔ Copie de la base : poussée (${Math.ceil(result.bytes / 1024)} Ko, chiffrée)`);
}

const lockSql = connectOrQuit("lock");
let instance: Awaited<ReturnType<typeof holdSingleInstance>> = null;
try {
  instance = await holdSingleInstance(lockSql, "copie");
  if (instance === null) {
    console.error("🛑 Une autre copie de la base tourne déjà : celle-ci ne fait rien.");
    process.exitCode = 75;
  } else await copy();
} catch (error) {
  console.error(`🛑 Copie de la base : ${errorText(error, [CopieError])}`);
  process.exitCode = 1;
} finally {
  await instance?.release();
  await lockSql.end();
}
