/**
 * `npm run liaison:cle` (ADR-0048): draws the liaison's own ed25519 key pair,
 * at the path liaison.local.toml names. The private part stays on the Mac,
 * 600, never shown; an existing key is never overwritten. What is printed is
 * the one line to write on the VM — the public key, under its forced command.
 * Writing it there is my gesture (or a sudo with my explicit consent).
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { errorText, refuseForeignSecrets, UsageError } from "@cenacle/core";
import { LIAISON_CONFIG_FILE, parseLiaisonPorte } from "@cenacle/securite";
import { keyIsPrivate } from "./ssh.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const KEYGEN = "/usr/bin/ssh-keygen";
const COMMENT = "cenacle-liaison";
/** The forced command of the house's VM (L1, the house's docs/liaison.md). */
export const FORCED = 'restrict,command="/opt/maison/liaison/maison-liaison"';
/** An ed25519 public key: 68 characters of base64, and our comment. */
const PUBLIC = /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]{43} cenacle-liaison\n?$/;

/** The line for the VM's authorized_keys, from a public key file's text; null if malformed. */
export function ligneAutorisee(publicKey: string): string | null {
  if (!PUBLIC.test(publicKey)) return null;
  return `${FORCED} ${publicKey.trim()}`;
}

function keygen(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      KEYGEN,
      ["-q", "-t", "ed25519", "-N", "", "-C", COMMENT, "-f", path],
      { env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME ?? "", LANG: "C" } },
      (error) => (error === null ? resolve() : reject(new UsageError("ssh-keygen a échoué"))),
    );
  });
}

async function main(): Promise<void> {
  refuseForeignSecrets("La clé de la liaison", []);
  const path = join(ROOT, LIAISON_CONFIG_FILE);
  if (!existsSync(path)) throw new UsageError(`${LIAISON_CONFIG_FILE} absent (voir l'exemple)`);
  const { cle } = parseLiaisonPorte(readFileSync(path, "utf8"));
  if (existsSync(cle) || existsSync(`${cle}.pub`)) {
    throw new UsageError("une clé existe déjà à ce chemin : rien n'est écrasé");
  }
  await keygen(cle);
  if (!keyIsPrivate(cle)) throw new UsageError("la clé tirée n'est pas en 600 : à vérifier");
  const ligne = ligneAutorisee(readFileSync(`${cle}.pub`, "utf8"));
  if (ligne === null) throw new UsageError("la clé publique tirée n'a pas la forme attendue");
  console.log("Clé tirée (la partie privée reste sur le Mac, jamais affichée).");
  console.log("Ligne à inscrire sur la VM, dans /var/lib/maison/liaison/.ssh/authorized_keys :\n");
  console.log(ligne);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`🛑 ${errorText(error, [UsageError])}`);
    process.exitCode = 1;
  });
}
