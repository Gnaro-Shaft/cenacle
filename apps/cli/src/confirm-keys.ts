/**
 * Generates the bot's signing key pair (ADR-0036). Usage: npm run keys:confirm
 * The private key goes to .env.bot (git-ignored, readable by me only), which
 * only `npm run bot` loads. The public key is printed: it goes into .env,
 * where the operator reads it. Never overwrites an existing .env.bot: a new
 * key would make every confirmation not yet run fail. A pair of its own,
 * never the page's (npm run keys:accept).
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIRM_PRIVATE_KEY_VAR,
  CONFIRM_PUBLIC_KEY_VAR,
  generateConfirmationKeys,
} from "@cenacle/core";

const path = join(import.meta.dirname, "..", "..", "..", ".env.bot");
if (existsSync(path)) {
  console.error(
    "🛑 .env.bot existe déjà : rien n'est changé. Pour changer de clé, supprime-le d'abord (les confirmations pas encore exécutées seront refusées).",
  );
  process.exitCode = 1;
} else {
  const { privateKey, publicKey } = generateConfirmationKeys();
  writeFileSync(
    path,
    `# The bot's signing key (ADR-0036). Loaded by \`npm run bot\` only. Never commit.\n${CONFIRM_PRIVATE_KEY_VAR}=${privateKey}\n`,
    { mode: 0o600, flag: "wx" },
  );
  console.log("✔ clé privée écrite dans .env.bot (lisible par toi seul)");
  console.log("Ajoute cette ligne à .env (clé publique, pour l'opérateur) :\n");
  console.log(`${CONFIRM_PUBLIC_KEY_VAR}=${publicKey}`);
}
