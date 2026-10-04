/**
 * Encrypted backup of the secret files and of the opposition list (phase 5, S1, C3).
 * Usage:
 *   npm run secrets:backup -- --out <fichier>
 *       seals .env, every .env.* family file, and the opposition list
 *   npm run secrets:restore -- --from <fichier> [--into <dossier>]
 *       writes the files back (here, or into a fresh checkout), never over an
 *       existing one; here, also writes the opposition list back into the base
 *   npm run secrets:restore -- --from <fichier> --opposition-seule
 *       only the opposition list, once the base of a fresh checkout is migrated
 * The opposition list is the one thing of the base that is backed up: its keys
 * are useless without CENACLE_MAIL_KEY, sealed with them, so both come back
 * together. The passphrase is asked twice for a backup, never echoed on a
 * terminal, and never stored. Keep the backup away from the Mac.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openSecrets, SECRET_FAMILIES, sealSecrets } from "@cenacle/core";
import { connectAsApp, createPeople, type OppositionEntry } from "@cenacle/journal";
import { createPrompt } from "./prompt.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
/** The only files a backup holds, and the only ones a restore may write. */
const FILES = [".env", ...Object.values(SECRET_FAMILIES).map((f) => f.file)];
/** The opposition list travels in the archive under this name; it is never written as a file. */
const OPPOSITION = "opposition.json";
const USAGE =
  "usage : secrets-backup backup --out <fichier> | restore --from <fichier> [--into <dossier> | --opposition-seule]";

const args = process.argv.slice(2);
const action = args[0];
const option = (name: string) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const onlyOpposition = args.includes("--opposition-seule");

/** The base, reached with the .env of `dir` (the application password lives there). */
async function withPeople<T>(
  dir: string,
  run: (people: ReturnType<typeof createPeople>) => Promise<T>,
) {
  if (existsSync(join(dir, ".env"))) process.loadEnvFile(join(dir, ".env"));
  const sql = connectAsApp();
  try {
    return await run(createPeople(sql));
  } finally {
    await sql.end();
  }
}

async function restoreOpposition(files: Record<string, string>): Promise<void> {
  const raw = files[OPPOSITION];
  if (raw === undefined) {
    console.log(
      "ℹ cette sauvegarde ne contient pas de liste d'opposition (antérieure à son ajout)",
    );
    return;
  }
  const entries = JSON.parse(raw) as OppositionEntry[];
  const added = await withPeople(ROOT, (people) => people.restoreOpposition(entries));
  console.log(`✔ liste d'opposition : ${entries.length} clés sauvegardées, ${added} réinscrites`);
}

const prompt = createPrompt();
try {
  const out = option("--out");
  const from = option("--from");
  const into = option("--into");
  if (action === "backup" && out !== undefined) {
    const files: Record<string, string> = {};
    for (const name of FILES) {
      if (existsSync(join(ROOT, name))) files[name] = readFileSync(join(ROOT, name), "utf8");
    }
    // No base, no backup: a backup without the opposition list would look complete and not be.
    const opposition = await withPeople(ROOT, (people) => people.opposition());
    files[OPPOSITION] = JSON.stringify(opposition);
    const pass = await prompt.secret("Phrase de passe (12 caractères au moins) : ");
    if ((await prompt.secret("La même, encore : ")) !== pass) {
      throw new Error("les deux phrases diffèrent : rien n'a été écrit");
    }
    writeFileSync(out, sealSecrets(files, pass), { mode: 0o600, flag: "wx" });
    const names = Object.keys(files).filter((n) => n !== OPPOSITION);
    console.log(
      `✔ sauvegarde chiffrée : ${names.join(", ")}, et ${opposition.length} clés de la liste d'opposition — à garder loin du Mac`,
    );
  } else if (
    action === "restore" &&
    from !== undefined &&
    !(onlyOpposition && into !== undefined)
  ) {
    const files = openSecrets(
      readFileSync(from, "utf8"),
      await prompt.secret("Phrase de passe : "),
    );
    if (onlyOpposition) {
      await restoreOpposition(files);
    } else {
      const target = into ?? ROOT;
      const names = Object.keys(files).filter((n) => n !== OPPOSITION);
      const unknown = names.filter((name) => !FILES.includes(name));
      if (unknown.length > 0) throw new Error(`fichiers inattendus : ${unknown.join(", ")}`);
      const present = names.filter((name) => existsSync(join(target, name)));
      if (present.length > 0) {
        throw new Error(`rien n'est restauré, déjà présents : ${present.join(", ")}`);
      }
      for (const name of names) {
        writeFileSync(join(target, name), files[name] ?? "", { mode: 0o600, flag: "wx" });
      }
      console.log(`✔ restauré : ${names.join(", ")}`);
      if (into === undefined) await restoreOpposition(files);
      else {
        console.log(
          "ℹ liste d'opposition : une fois la base de cette installation migrée, lance secrets:restore avec --opposition-seule",
        );
      }
    }
  } else {
    throw new Error(USAGE);
  }
} catch (error) {
  console.error(`🛑 ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  prompt.close();
}
