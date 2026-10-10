/**
 * Cénacle's programs as launchd services (ADR-0018, ADR-0019).
 * Usage: npm run service -- install|uninstall|status iris|server|bot|web|cto|all
 * (npm run iris:service -- install|uninstall|status: Iris alone).
 *
 * It holds no secret (no env file is loaded): each plist names files, never
 * values. Installing changes this Mac's login items: run it yourself.
 */
import { execFile } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { errorText, refuseForeignSecrets, SecretPlacementError } from "@cenacle/core";
import {
  install,
  PROGRAMS,
  type Program,
  SCHEDULED,
  type ServiceDeps,
  status,
  THROTTLE_SECONDS,
  uninstall,
} from "./launchd.ts";

refuseForeignSecrets("L'installeur des services", []);

const NAMES: Record<Program, string> = {
  iris: "Iris",
  server: "Le serveur de la page",
  bot: "Le bot Telegram",
  web: "La page",
  cto: "Le CTO",
  veille: "La veille du CTO",
  securite: "L'agent sécurité",
};
const COMMANDS = ["install", "uninstall", "status"] as const;
type Command = (typeof COMMANDS)[number];

const deps: ServiceDeps = {
  home: homedir(),
  root: join(import.meta.dirname, "..", "..", ".."),
  nodePath: process.execPath,
  uid: userInfo().uid,
  launchctl: (args) =>
    new Promise((resolve) => {
      execFile("/bin/launchctl", [...args], (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
        resolve({ code, output: `${stdout}${stderr}` });
      });
    }),
};

// Order-free: `iris:service -- install` arrives as ["iris", "install"].
const args = process.argv.slice(2);
const command = args.find((a): a is Command => (COMMANDS as readonly string[]).includes(a));
const target = args.find((a) => a === "all" || (PROGRAMS as readonly string[]).includes(a));
if (command === undefined || target === undefined || args.length !== 2) {
  console.error(`usage : npm run service -- ${COMMANDS.join("|")} ${PROGRAMS.join("|")}|all`);
  process.exit(64);
}
const programs: readonly Program[] = target === "all" ? PROGRAMS : [target as Program];

try {
  for (const program of programs) {
    const name = NAMES[program];
    if (command === "install") {
      const p = await install(program, deps);
      console.log(`✔ ${name} est confié(e) à launchd (${p.label}) — journal : ${p.log}`);
    } else if (command === "uninstall") {
      const p = await uninstall(program, deps);
      console.log(`✔ ${name} n'est plus confié(e) à launchd (${p.label} retiré).`);
    } else {
      const s = await status(program, deps);
      const at = SCHEDULED[program];
      if (at !== undefined && s.loaded && s.pid === null) {
        console.log(
          `${name} : en attente du prochain passage (${at.hour} h${at.minute === 0 ? "" : ` ${String(at.minute).padStart(2, "0")}`}) · dernier code de sortie ${s.lastExitCode ?? "—"}`,
        );
        continue;
      }
      console.log(
        !s.installed && !s.loaded
          ? `${name} : pas confié(e) à launchd`
          : `${name} : ${s.loaded ? "chargé" : "non chargé"} · état ${s.state ?? "—"} · pid ${
              s.pid ?? "—"
            } · dernier code de sortie ${s.lastExitCode ?? "—"}`,
      );
    }
  }
  if (command === "install" && programs.some((p) => SCHEDULED[p] === undefined)) {
    console.log("  Démarrage à chaque ouverture de session ; relance seulement après un plantage,");
    console.log(
      `  jamais après /stop, Ctrl+C ou SIGTERM. Un exemplaire lancé à la main garde la main : celui de launchd réessaie toutes les ${THROTTLE_SECONDS} s.`,
    );
  }
  if (command === "install" && programs.some((p) => SCHEDULED[p] !== undefined)) {
    console.log(
      "  La veille part chaque jour à 8 h, l'agent sécurité à 7 h 30 ; Mac en veille : au réveil ; éteint ou session fermée : ce jour-là est sauté.",
    );
  }
} catch (error) {
  console.error(`🛑 ${errorText(error, [SecretPlacementError])}`);
  process.exitCode = 1;
}
