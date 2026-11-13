/**
 * Writes the environment files of a fresh checkout (lot D5). Usage: npm run setup
 * Every secret is drawn here and written for me only (0600). Never over an
 * existing file: if one is there, nothing is written, and it says which.
 * What is left for me: LOCAL_MODEL_ID in .env; Telegram and a real mailbox,
 * when I want them (.env.example says where).
 */
import { randomBytes } from "node:crypto";
import { lstatSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { errorText, generateAcceptanceKeys, generateConfirmationKeys } from "@cenacle/core";
import { setupFiles } from "./setup-env.ts";

type Write = (path: string, text: string) => void;
const writeForMe: Write = (path, text) => writeFileSync(path, text, { mode: 0o600, flag: "wx" });

export function writeSetup(
  root: string,
  write: Write = writeForMe,
): { written: string[]; present: string[] } {
  const files = setupFiles(readFileSync(join(root, ".env.example"), "utf8"), {
    hex: (bytes) => randomBytes(bytes).toString("hex"),
    acceptKeys: generateAcceptanceKeys(),
    confirmKeys: generateConfirmationKeys(),
  });
  // lstat, not exists: a dangling link is something there too (D5 review).
  const present = [...files.keys()].filter((name) => {
    try {
      lstatSync(join(root, name));
      return true;
    } catch {
      return false;
    }
  });
  if (present.length > 0) return { written: [], present };
  // All or nothing: a write that fails midway takes back the ones before it,
  // so that a rerun is never refused by half a set of fresh secrets.
  const written: string[] = [];
  try {
    for (const [name, text] of files) {
      write(join(root, name), text);
      written.push(name);
    }
  } catch (error) {
    for (const name of written) unlinkSync(join(root, name));
    throw error;
  }
  return { written, present: [] };
}

if (import.meta.main) {
  let result: ReturnType<typeof writeSetup>;
  try {
    result = writeSetup(join(import.meta.dirname, "..", "..", ".."));
  } catch (error) {
    console.error(`🛑 ${errorText(error)} — rien n'est écrit.`);
    process.exit(1);
  }
  const { written, present } = result;
  if (present.length > 0) {
    console.error(
      `🛑 déjà là : ${present.join(", ")} — rien n'est écrit (aucun secret n'est remplacé).`,
    );
    process.exitCode = 1;
  } else {
    console.log(`✔ écrits, lisibles par toi seul : ${written.join(", ")}`);
    console.log("Reste à faire : LOCAL_MODEL_ID dans .env (ollama list), puis npm run db:up.");
  }
}
