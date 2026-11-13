/**
 * Writes the environment files of a fresh checkout (lot D5). Usage: npm run setup
 * Every secret is drawn here and written for me only (0600). Never over an
 * existing file: if one is there, nothing is written, and it says which.
 * What is left for me: LOCAL_MODEL_ID in .env; Telegram and a real mailbox,
 * when I want them (.env.example says where).
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateAcceptanceKeys, generateConfirmationKeys } from "@cenacle/core";
import { setupFiles } from "./setup-env.ts";

export function writeSetup(root: string): { written: string[]; present: string[] } {
  const files = setupFiles(readFileSync(join(root, ".env.example"), "utf8"), {
    hex: (bytes) => randomBytes(bytes).toString("hex"),
    acceptKeys: generateAcceptanceKeys(),
    confirmKeys: generateConfirmationKeys(),
  });
  const present = [...files.keys()].filter((name) => existsSync(join(root, name)));
  if (present.length > 0) return { written: [], present };
  for (const [name, text] of files) {
    writeFileSync(join(root, name), text, { mode: 0o600, flag: "wx" });
  }
  return { written: [...files.keys()], present: [] };
}

if (import.meta.main) {
  const { written, present } = writeSetup(join(import.meta.dirname, "..", "..", ".."));
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
