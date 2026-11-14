/**
 * Where an encrypted backup goes (npm run secrets:backup -- --out <fichier>),
 * checked before the passphrase is asked: a backup is never written over
 * another, and « Error (EEXIST) » after typing the passphrase twice told me
 * nothing. Paths only: they are mine, typed at my terminal.
 */
import { lstatSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Why `out` cannot take a new backup, in words, or null. */
export function backupTargetProblem(out: string): string | null {
  if (out.trim() === "") return "--out attend un nom de fichier";
  const path = resolve(out);
  try {
    // lstat: a link, even a dangling one, is something there too.
    lstatSync(path);
    return `${out} existe déjà, et une sauvegarde n'en écrase jamais une autre : donne un autre nom (par exemple avec la date du jour)`;
  } catch {
    // nothing there: good
  }
  const folder = dirname(path);
  try {
    if (!statSync(folder).isDirectory()) return `${folder} n'est pas un dossier`;
  } catch {
    return `le dossier ${folder} n'existe pas${folder.startsWith("/Volumes/") ? " : la clé est-elle branchée ?" : ""}`;
  }
  return null;
}
