/**
 * Encrypted backup of the secret files (phase 5, S1).
 * Usage:
 *   npm run secrets:backup -- --out <fichier>    seal .env and every .env.* family file
 *   npm run secrets:restore -- --from <fichier> [--into <dossier>]
 *                                                write them back (here, or into a fresh checkout),
 *                                                never over an existing file
 * The passphrase is asked twice for a backup, never echoed on a terminal, and
 * never stored. Keep the backup away from the Mac (a USB key, for instance).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openSecrets, SECRET_FAMILIES, sealSecrets } from "@cenacle/core";
import { createPrompt } from "./prompt.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
/** The only files a backup holds, and the only ones a restore may write. */
const FILES = [".env", ...Object.values(SECRET_FAMILIES).map((f) => f.file)];
const [action, flag, path, intoFlag, into] = process.argv.slice(2);
const USAGE =
  "usage : secrets-backup backup --out <fichier> | restore --from <fichier> [--into <dossier>]";

const prompt = createPrompt();
try {
  if (action === "backup" && flag === "--out" && path !== undefined) {
    const files: Record<string, string> = {};
    for (const name of FILES) {
      if (existsSync(join(ROOT, name))) files[name] = readFileSync(join(ROOT, name), "utf8");
    }
    const pass = await prompt.secret("Phrase de passe (12 caractères au moins) : ");
    if ((await prompt.secret("La même, encore : ")) !== pass) {
      throw new Error("les deux phrases diffèrent : rien n'a été écrit");
    }
    writeFileSync(path, sealSecrets(files, pass), { mode: 0o600, flag: "wx" });
    console.log(`✔ sauvegarde chiffrée : ${Object.keys(files).join(", ")} — à garder loin du Mac`);
  } else if (
    action === "restore" &&
    flag === "--from" &&
    path !== undefined &&
    (intoFlag === undefined || (intoFlag === "--into" && into !== undefined))
  ) {
    const target = into ?? ROOT;
    const files = openSecrets(
      readFileSync(path, "utf8"),
      await prompt.secret("Phrase de passe : "),
    );
    const unknown = Object.keys(files).filter((name) => !FILES.includes(name));
    if (unknown.length > 0) throw new Error(`fichiers inattendus : ${unknown.join(", ")}`);
    const present = Object.keys(files).filter((name) => existsSync(join(target, name)));
    if (present.length > 0) {
      throw new Error(`rien n'est restauré, déjà présents : ${present.join(", ")}`);
    }
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(target, name), content, { mode: 0o600, flag: "wx" });
    }
    console.log(`✔ restauré : ${Object.keys(files).join(", ")}`);
  } else {
    throw new Error(USAGE);
  }
} catch (error) {
  console.error(`🛑 ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  prompt.close();
}
