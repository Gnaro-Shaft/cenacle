/**
 * Generates the page's signing key pair (ADR-0013). Usage: npm run keys:accept
 * The private key goes to .env.page (git-ignored, readable by me only), which
 * only `npm run server` loads. The public key is printed: it goes into .env,
 * where the executor reads it. Never overwrites an existing .env.page: a new
 * key would make every acceptance not yet sent fail.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateAcceptanceKeys, PRIVATE_KEY_VAR, PUBLIC_KEY_VAR } from "@cenacle/core";

const path = join(import.meta.dirname, "..", "..", "..", ".env.page");
if (existsSync(path)) {
  console.error(
    "🛑 .env.page existe déjà : rien n'est changé. Pour changer de clé, supprime-le d'abord (les acceptations pas encore envoyées échoueront).",
  );
  process.exitCode = 1;
} else {
  const { privateKey, publicKey } = generateAcceptanceKeys();
  writeFileSync(
    path,
    `# The page's signing key (ADR-0013). Loaded by \`npm run server\` only. Never commit.\n${PRIVATE_KEY_VAR}=${privateKey}\n`,
    { mode: 0o600, flag: "wx" },
  );
  console.log("✔ clé privée écrite dans .env.page (lisible par toi seul)");
  console.log("Ajoute cette ligne à .env (clé publique, pour l'exécuteur) :\n");
  console.log(`${PUBLIC_KEY_VAR}=${publicKey}`);
}
