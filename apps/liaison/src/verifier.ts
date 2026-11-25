/**
 * `npm run liaison:verifier` (ADR-0048): says, on the Mac, whether the
 * liaison can run — the switch, liaison.local.toml (by the kind of its
 * error), the key (600), the pinned known_hosts, the retentions, the page's
 * public key — then reads `etat` once, which changes nothing on the VM.
 * It prints kinds and numbers only: never a value of the file, never a title.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { errorText, publicKeyFromEnv, refuseForeignSecrets, UsageError } from "@cenacle/core";
import { loadCadre } from "@cenacle/mail";
import {
  LIAISON_CONFIG_FILE,
  LIAISON_SWITCH_FILE,
  LiaisonConfigError,
  parseLiaisonDossiers,
  parseLiaisonPorte,
  parseLiaisonSwitch,
} from "@cenacle/securite";
import { lireEtat, MAX_ETAT } from "./reponse.ts";
import { appeler, keyIsPrivate, sshArgs } from "./ssh.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const readOrNull = (name: string) => {
  const p = join(ROOT, name);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};
const ok = (what: string) => console.log(`✔ ${what}`);
const ko = (what: string) => {
  console.log(`✘ ${what}`);
  process.exitCode = 1;
};

async function main(): Promise<void> {
  refuseForeignSecrets("Le vérificateur de la liaison", ["telegram"]);
  const s = parseLiaisonSwitch(readOrNull(LIAISON_SWITCH_FILE));
  (s === "illisible" ? ko : ok)(`interrupteur : ${s}`);
  const text = readOrNull(LIAISON_CONFIG_FILE);
  if (text === null) return ko(`${LIAISON_CONFIG_FILE} absent`);
  let porte: ReturnType<typeof parseLiaisonPorte>;
  try {
    porte = parseLiaisonPorte(text);
    ok(`${LIAISON_CONFIG_FILE} : ${parseLiaisonDossiers(text).length} dossier(s)`);
  } catch (e) {
    if (e instanceof LiaisonConfigError) return ko(`${LIAISON_CONFIG_FILE} : ${e.problem}`);
    throw e;
  }
  (keyIsPrivate(porte.cle) ? ok : ko)("clé : présente, à moi seul (600)");
  (existsSync(porte.knownHosts) ? ok : ko)("known_hosts : présent");
  try {
    const c = loadCadre().conservation;
    (c.liaisonTexteJours !== undefined && c.liaisonJours !== undefined ? ok : ko)(
      "cadre : liaison_texte_jours et liaison_jours",
    );
  } catch (e) {
    ko(`cadre illisible (${e instanceof Error ? e.name : "inconnu"})`);
  }
  try {
    publicKeyFromEnv();
    ok("clé publique de la page : présente");
  } catch {
    ko("clé publique de la page : absente de .env");
  }
  if (process.exitCode === 1) return;
  const appel = await appeler(sshArgs(porte, "etat"), "", MAX_ETAT);
  const r = lireEtat(appel.code, appel.out);
  if (r.ok) ok(`etat lu : ${r.etats.length} demande(s), ${r.ecartes} élément(s) écarté(s)`);
  else ko(`etat non lu : ${r.categorie} (code ${appel.code})`);
}

main().catch((error) => {
  console.error(`🛑 ${errorText(error, [UsageError])}`);
  process.exitCode = 1;
});
