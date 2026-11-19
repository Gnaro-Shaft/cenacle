/**
 * npm run base:restaurer -- --depuis <copie.age> [--remplacer | --essai]
 * (ADR-0044, points 7 and 8). Run by me, at the terminal: it asks my private
 * key, never shown, never kept. It holds the owner family alone (.env.owner):
 * it writes the four tables as their owner. --essai reloads the test base
 * (cenacle_test), stops nothing, and compares it with production.
 * It says counts and table names, never a row, never a path of the copy's.
 */
import { execFile } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { errorText, refuseForeignSecrets } from "@cenacle/core";
import { loadVeilleConfig } from "@cenacle/cto/veille";
import { ownerUrlFromEnv } from "@cenacle/journal";
import { loadCadre } from "@cenacle/mail";
import postgres from "postgres";
import { readHiddenKey } from "./cle.ts";
import { CopieError, findContainer, findTool, TOOLS } from "./export.ts";
import type { Mode } from "./recharge.ts";
import { type RestoreResult, runRestore } from "./restaurer.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const USAGE = "npm run base:restaurer -- --depuis <copie.age> [--remplacer | --essai]";

export function parseArgs(args: readonly string[]): { file: string; mode: Mode } {
  let file: string | null = null;
  let mode: Mode = "vides";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = args[i + 1];
    if (a === "--depuis" && file === null && next !== undefined && !next.startsWith("--")) {
      file = next;
      i++;
    } else if (a === "--remplacer" && mode === "vides") mode = "remplacer";
    else if (a === "--essai" && mode === "vides") mode = "essai";
    else throw new CopieError(`argument inattendu — ${USAGE}`);
  }
  if (file === null) throw new CopieError(`--depuis manque — ${USAGE}`);
  return { file, mode };
}

const launchctl = (args: readonly string[]) =>
  new Promise<{ code: number; output: string }>((resolve) => {
    execFile("/bin/launchctl", [...args], (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
      resolve({ code, output: `${stdout}${stderr}` });
    });
  });

function report(result: RestoreResult, trial: boolean): void {
  console.log(`✔ Copie rechargée ${trial ? "dans la base de test" : "dans la base"} :`);
  for (const [table, n] of result.rows) {
    const purged = result.purged.get(table);
    const purge =
      purged === null ? "purge non rejouée (durée absente du cadre)" : `${purged} purgée(s)`;
    const same = result.same?.get(table);
    const verdict = same === undefined ? "" : same ? " — identique" : " — DIFFÈRE de la production";
    console.log(`  ${table} : ${n} ligne(s), ${purge}${verdict}`);
  }
  if (result.stopped.length > 0) console.log(`  Services relancés : ${result.stopped.join(", ")}`);
  if (result.notRestarted.length > 0) {
    console.error(
      `🛑 Ne repartent pas : ${result.notRestarted.join(", ")} — npm run service -- install <nom>`,
    );
    process.exitCode = 1;
  }
  if (!trial) {
    console.log(
      "  Ce que la copie ramène : un rappel annulé depuis revient, un rappel sonné depuis sonne de nouveau, une décision prise depuis est à reprendre.",
    );
  }
}

async function main(): Promise<void> {
  const { file, mode } = parseArgs(process.argv.slice(2));
  const ownerPassword = process.env.CENACLE_DB_OWNER_PASSWORD ?? "";
  if (ownerPassword === "") throw new CopieError("CENACLE_DB_OWNER_PASSWORD manque (.env.owner)");
  const trial = mode === "essai";
  const result = await runRestore({
    file,
    mode,
    readKey: () => readHiddenKey(process.stdin, (t) => process.stderr.write(t)),
    tools: { docker: findTool(TOOLS.docker), age: findTool(TOOLS.age) },
    container: (docker) => findContainer(docker, process.env.CENACLE_DB_PORT ?? "55432"),
    database: trial ? "cenacle_test" : "cenacle",
    production: trial ? "cenacle" : null,
    ownerPassword,
    connect: (database) => postgres(ownerUrlFromEnv(database), { max: 1, onnotice: () => {} }),
    services: trial
      ? null
      : { launchctl, uid: userInfo().uid, home: homedir(), pause: (ms) => sleep(ms) },
    retentions: () => {
      const conservation = loadCadre().conservation;
      return {
        rappelsJours: conservation.rappelsJours,
        prospectionJours: conservation.prospectionJours,
        veilleJours: loadVeilleConfig(ROOT).settings.veilleJours,
      };
    },
    now: () => new Date(),
    holdSignals: () => {
      const wait = () =>
        process.stderr.write(
          "\n⏳ Les services sont arrêtés : la restauration va jusqu'à les relancer.\n",
        );
      const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
      for (const s of signals) process.on(s, wait);
      return () => {
        for (const s of signals) process.off(s, wait);
      };
    },
  });
  report(result, trial);
}

if (import.meta.main) {
  refuseForeignSecrets("La restauration de la base", ["owner"]);
  try {
    await main();
  } catch (error) {
    console.error(`🛑 Restauration de la base : ${errorText(error, [CopieError])}`);
    process.exitCode = 1;
  }
}
