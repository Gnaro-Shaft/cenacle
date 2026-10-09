/**
 * Iris as a launchd service (ADR-0018).
 * Usage: npm run iris:service -- install | uninstall | status
 *
 * It holds no secret (no env file is loaded): the plist names files, never
 * values. Installing changes this Mac's login items: run it yourself.
 */
import { execFile } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { refuseForeignSecrets } from "@cenacle/core";
import { install, type ServiceDeps, status, THROTTLE_SECONDS, uninstall } from "./launchd.ts";

refuseForeignSecrets("L'installeur d'Iris", []);

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

const command = process.argv[2];
try {
  if (command === "install") {
    const p = await install("iris", deps);
    console.log(`✔ Iris est confiée à launchd (${p.label}).`);
    console.log("  Elle démarre à chaque ouverture de session, et repart si elle plante —");
    console.log("  jamais après /stop ni Ctrl+C.");
    console.log(`  Journal de la console : ${p.log}`);
    console.log(
      `  Une Iris lancée à la main garde la main : celle de launchd réessaie toutes les ${THROTTLE_SECONDS} s.`,
    );
  } else if (command === "uninstall") {
    const p = await uninstall("iris", deps);
    console.log(`✔ Iris n'est plus confiée à launchd (${p.label} retiré).`);
  } else if (command === "status") {
    const s = await status("iris", deps);
    if (!s.installed && !s.loaded) {
      console.log("Iris n'est pas confiée à launchd (npm run iris:service -- install).");
    } else {
      console.log(
        `launchd : ${s.loaded ? "chargé" : "non chargé"} · état ${s.state ?? "—"} · pid ${
          s.pid ?? "—"
        } · dernier code de sortie ${s.lastExitCode ?? "—"}`,
      );
    }
  } else {
    console.error("usage : npm run iris:service -- install | uninstall | status");
    process.exitCode = 64;
  }
} catch (error) {
  console.error(`🛑 ${error instanceof Error ? error.message : "erreur"}`);
  process.exitCode = 1;
}
