/**
 * Splits .env into one file per family of secrets (phase 5, S1 — ADR-0013).
 * Usage: npm run secrets:split
 * Shows what moves where (variable names, never values), asks for "OUI",
 * keeps a copy of the old .env (.env.avant-split, readable by me only), then
 * writes each family's file (readable by me only) and leaves in .env what is
 * not a secret. Refuses when a variable is already in its target file.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  errorText,
  SECRET_FAMILIES,
  type SecretFamily,
  SecretPlacementError,
  splitEnv,
  UsageError,
} from "@cenacle/core";
import { createPrompt } from "./prompt.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const at = (name: string) => join(ROOT, name);
const NAME = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const namesIn = (text: string) =>
  text.split("\n").flatMap((l) => {
    const name = NAME.exec(l)?.[1];
    return name === undefined ? [] : [name];
  });

const prompt = createPrompt();
try {
  if (!existsSync(at(".env"))) throw new UsageError(".env est introuvable");
  const original = readFileSync(at(".env"), "utf8");
  const plan = splitEnv(original);
  const families = Object.keys(plan.moved) as SecretFamily[];
  if (families.length === 0) {
    console.log("✔ rien à déplacer : .env ne contient plus aucun secret");
  } else {
    const conflicts: string[] = [];
    for (const family of families) {
      const file = SECRET_FAMILIES[family].file;
      if (!existsSync(at(file))) continue;
      const already = new Set(namesIn(readFileSync(at(file), "utf8")));
      for (const name of namesIn((plan.moved[family] ?? []).join("\n"))) {
        if (already.has(name)) conflicts.push(`${name} (déjà dans ${file})`);
      }
    }
    if (conflicts.length > 0) {
      throw new UsageError(`rien n'est fait, en double : ${conflicts.join(", ")}`);
    }
    if (existsSync(at(".env.avant-split"))) {
      throw new UsageError(
        "rien n'est fait : .env.avant-split existe déjà (une répartition précédente ?)",
      );
    }
    console.log("Ce qui va être déplacé (noms seulement) :");
    for (const [file, names] of Object.entries(plan.summary)) {
      console.log(`  ${file} ← ${(names ?? []).join(", ")}`);
    }
    if ((await prompt.ask("Répartir ainsi ? Tape OUI : ")) !== "OUI") {
      throw new UsageError("rien n'a été fait");
    }
    writeFileSync(at(".env.avant-split"), original, { mode: 0o600, flag: "wx" });
    for (const family of families) {
      const file = SECRET_FAMILIES[family].file;
      const lines = `${(plan.moved[family] ?? []).join("\n")}\n`;
      if (existsSync(at(file))) {
        writeFileSync(at(file), lines, { flag: "a" });
      } else {
        const header = `# ${family} — git-ignored, readable by me only (ADR-0013).\n`;
        writeFileSync(at(file), header + lines, { mode: 0o600, flag: "wx" });
      }
      chmodSync(at(file), 0o600);
    }
    writeFileSync(at(".env"), plan.remaining.join("\n"));
    chmodSync(at(".env"), 0o600);
    console.log(
      "✔ réparti. L'ancien .env est copié dans .env.avant-split : à supprimer quand tout tourne, après une sauvegarde (npm run secrets:backup).",
    );
  }
} catch (error) {
  // Messages name variables and files, never a value.
  console.error(`🛑 ${errorText(error, [SecretPlacementError])}`);
  process.exitCode = 1;
} finally {
  prompt.close();
}
