/**
 * The database owner stops being a superuser, once (ADR-0038, point 4).
 * Usage: npm run db:bascule -- --essai    what it would do, nothing changed
 *        npm run db:bascule               the switch
 *        npm run db:bascule -- --retour   back as before
 *
 * Before anything: a dump of the database (pg_dump, for me only, 0600). The
 * new files are written aside first (.nouveau), then put in place only once
 * the database has committed: never a password the database does not know,
 * never one it knows that no file keeps. No password is ever shown.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { errorText, UsageError } from "@cenacle/core";
import {
  BasculeError,
  type Cluster,
  NothingChanged,
  type SwitchOptions,
  switchBack,
  switchOwner,
  switchPreview,
} from "@cenacle/journal";

const OWNER_FILE = ".env.owner";
const ADMIN_FILE = ".env.admin";
/** Today's .env.owner, kept until I delete it: the way back if a file is lost. */
const KEPT_FILE = ".env.owner.avant-bascule";
const ASIDE = ".nouveau";
const OWNER_VAR = "CENACLE_DB_OWNER_PASSWORD";
const SWITCH_LEFT =
  "le super-utilisateur temporaire cenacle_bascule n'a pas pu être supprimé (il expire dans 15 min) : DROP ROLE cenacle_bascule, avec .env.admin";
const ADMIN_VAR = "CENACLE_DB_ADMIN_PASSWORD";

/** The database side (packages/journal/src/bascule.ts); tests give their own. */
export interface BasculeDb {
  readonly preview: typeof switchPreview;
  readonly switch: typeof switchOwner;
  readonly back: typeof switchBack;
}

const REAL_DB: BasculeDb = { preview: switchPreview, switch: switchOwner, back: switchBack };

export interface BasculeDeps {
  readonly root: string;
  readonly cluster: Cluster;
  /** Dumps the database before the switch; returns the dump's path. */
  readonly dump: () => string;
  readonly options?: SwitchOptions;
  readonly db?: BasculeDb;
}

function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** A variable's value in one of the env files; the value is never shown. */
export function readVar(root: string, file: string, name: string): string {
  const path = join(root, file);
  if (!present(path)) throw new UsageError(`${file} manque`);
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match?.[1] === name && (match[2] ?? "") !== "") return match[2] ?? "";
  }
  throw new UsageError(`${name} manque dans ${file}`);
}

function writeForMe(path: string, name: string, value: string): void {
  writeFileSync(
    path,
    `# Written by npm run db:bascule (ADR-0038). Never commit.\n${name}=${value}\n`,
    { mode: 0o600, flag: "wx" },
  );
}

function refuseIfPresent(root: string, files: readonly string[]): void {
  const there = files.filter((f) => present(join(root, f)));
  if (there.length > 0) {
    throw new UsageError(`déjà là : ${there.join(", ")} — rien n'est fait`);
  }
}

const draw = () => randomBytes(24).toString("hex");

/**
 * The files must be the ones the services read: in a worktree, .env.owner is
 * a link to the main checkout's, and renaming the link would leave the real
 * file stale and the new passwords in a folder that may be deleted.
 */
function refuseLinks(root: string, files: readonly string[]): void {
  const links = files.filter((f) => {
    try {
      return lstatSync(join(root, f)).isSymbolicLink();
    } catch {
      return false;
    }
  });
  if (links.length > 0) {
    throw new UsageError(
      `${links.join(", ")} : un lien — lancer depuis le dossier principal du dépôt, celui que les services lisent`,
    );
  }
}

/** Removes the files written aside — only once the database said nothing changed. */
function dropAside(root: string, files: readonly string[]): void {
  for (const f of files) {
    try {
      unlinkSync(join(root, f));
    } catch {
      // already gone: nothing to keep
    }
  }
}

/** A failure the database did not undo for sure: every new password stays, and it is said. */
function uncertain(error: unknown, kept: readonly string[]): never {
  if (error instanceof NothingChanged) throw error;
  throw new BasculeError(
    `${error instanceof Error ? error.message : String(error)} — rien n'est effacé : ${kept.join(", ")} gardent les nouveaux mots de passe`,
  );
}

/** The switch: dump, files aside, the database, then the files in place. */
export async function forward(deps: BasculeDeps) {
  const { root, cluster } = deps;
  const db = deps.db ?? REAL_DB;
  refuseLinks(root, [OWNER_FILE]);
  const current = readVar(root, OWNER_FILE, OWNER_VAR);
  refuseIfPresent(root, [ADMIN_FILE, KEPT_FILE, OWNER_FILE + ASIDE, ADMIN_FILE + ASIDE]);
  const { state, scram } = await db.preview(cluster, current);
  if (state !== "before") throw new BasculeError("la bascule est déjà faite");
  if (!scram) {
    throw new BasculeError(
      "le mot de passe de cenacle_owner n'est pas en SCRAM : le renommage l'effacerait — le redéfinir d'abord, rien n'est fait",
    );
  }
  const dump = deps.dump();
  const next = draw();
  writeForMe(join(root, OWNER_FILE + ASIDE), OWNER_VAR, next);
  writeForMe(join(root, ADMIN_FILE + ASIDE), ADMIN_VAR, current);
  let result: Awaited<ReturnType<typeof switchOwner>>;
  try {
    result = await db.switch(cluster, { current, next, temp: draw() }, deps.options);
  } catch (error) {
    // Checked rolled back: today's .env.owner is still the right one.
    if (error instanceof NothingChanged) dropAside(root, [OWNER_FILE + ASIDE, ADMIN_FILE + ASIDE]);
    uncertain(error, [OWNER_FILE + ASIDE, ADMIN_FILE + ASIDE]);
  }
  // In an order that never leaves the folder without a .env.owner: a copy
  // kept aside, the admin's file, then the owner's replaced in one step.
  copyFileSync(join(root, OWNER_FILE), join(root, KEPT_FILE), constants.COPYFILE_EXCL);
  chmodSync(join(root, KEPT_FILE), 0o600);
  renameSync(join(root, ADMIN_FILE + ASIDE), join(root, ADMIN_FILE));
  renameSync(join(root, OWNER_FILE + ASIDE), join(root, OWNER_FILE));
  return { ...result, dump };
}

/** Back as before: the admin's password is the owner's again, .env.admin goes. */
export async function back(deps: Omit<BasculeDeps, "dump">) {
  const { root, cluster } = deps;
  const db = deps.db ?? REAL_DB;
  refuseLinks(root, [OWNER_FILE, ADMIN_FILE]);
  const admin = readVar(root, ADMIN_FILE, ADMIN_VAR);
  refuseIfPresent(root, [OWNER_FILE + ASIDE]);
  writeForMe(join(root, OWNER_FILE + ASIDE), OWNER_VAR, admin);
  let result: Awaited<ReturnType<typeof switchBack>>;
  try {
    result = await db.back(cluster, { admin, temp: draw() });
  } catch (error) {
    if (error instanceof NothingChanged) dropAside(root, [OWNER_FILE + ASIDE]);
    uncertain(error, [OWNER_FILE + ASIDE]);
  }
  // The new owner's password names a role that no longer exists; the kept
  // file holds the same password as .env.admin. Neither is needed any more.
  renameSync(join(root, OWNER_FILE + ASIDE), join(root, OWNER_FILE));
  unlinkSync(join(root, ADMIN_FILE));
  if (present(join(root, KEPT_FILE))) unlinkSync(join(root, KEPT_FILE));
  return result;
}

/** pg_dump inside the database's container, found by its published port. */
export function dumpDatabase(cluster: Cluster, dir: string): string {
  const ps = spawnSync(
    "docker",
    ["ps", "--filter", `publish=${cluster.port}`, "--format", "{{.Names}}"],
    {
      encoding: "utf8",
    },
  );
  const names = (ps.stdout ?? "").split("\n").filter((n) => n !== "");
  if (ps.status !== 0 || names.length !== 1) {
    throw new BasculeError(
      `aucun conteneur unique ne publie le port ${cluster.port} : pas de sauvegarde, rien n'est fait`,
    );
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `avant-bascule-${new Date().toISOString().replaceAll(":", "-")}.dump`);
  const fd = openSync(file, "wx", 0o600);
  let run: ReturnType<typeof spawnSync>;
  try {
    run = spawnSync(
      "docker",
      ["exec", names[0] ?? "", "pg_dump", "-U", "cenacle_owner", "-d", cluster.database, "-Fc"],
      { stdio: ["ignore", fd, "ignore"] },
    );
  } finally {
    closeSync(fd);
  }
  if (run.status !== 0 || statSync(file).size === 0) {
    unlinkSync(file);
    throw new BasculeError("la sauvegarde (pg_dump) a échoué : rien n'est fait");
  }
  return file;
}

if (import.meta.main) {
  const cluster: Cluster = {
    host: process.env.CENACLE_DB_HOST ?? "127.0.0.1",
    port: process.env.CENACLE_DB_PORT ?? "55432",
    database: "cenacle",
    testDatabase: "cenacle_test",
  };
  const root = join(import.meta.dirname, "..", "..", "..");
  const mode = process.argv.slice(2);
  try {
    if (mode.length === 1 && mode[0] === "--essai") {
      const { state, statements, scram } = await switchPreview(
        cluster,
        readVar(root, OWNER_FILE, OWNER_VAR),
      );
      if (state === "done") {
        console.log("✔ La bascule est déjà faite : cenacle_owner n'est pas super-utilisateur.");
      } else {
        console.log(
          `La bascule transférerait ${statements.length} objet(s) à un nouveau cenacle_owner :`,
        );
        for (const s of statements) console.log(`  ${s}`);
        if (!scram) console.log("⚠ Mot de passe pas en SCRAM : la bascule serait refusée.");
        console.log("Rien n'est changé (--essai).");
      }
    } else if (mode.length === 1 && mode[0] === "--retour") {
      const undone = await back({ root, cluster });
      if (undone.switchRoleLeft) console.log(`⚠ ${SWITCH_LEFT}`);
      console.log(
        "✔ Retour fait : cenacle_owner est de nouveau le super-utilisateur, .env.admin est retiré.",
      );
      console.log("Ensuite : npm run db:migrate.");
    } else if (mode.length === 0) {
      const dir = join(homedir(), "Library", "Application Support", "cenacle", "sauvegardes");
      const done = await forward({ root, cluster, dump: () => dumpDatabase(cluster, dir) });
      console.log(
        `✔ Bascule faite : ${done.transferred} objet(s) transférés au nouveau cenacle_owner.`,
      );
      console.log(
        `  ${OWNER_FILE} (nouveau), ${ADMIN_FILE} (le super-utilisateur), ${KEPT_FILE} (l'ancien, à supprimer une fois vérifié).`,
      );
      if (done.switchRoleLeft) console.log(`  ⚠ ${SWITCH_LEFT}`);
      if (!done.testDropped)
        console.log("  ⚠ La base de test n'a pas pu être supprimée : les tests la recréeront.");
      console.log(
        `  Sauvegarde : ${done.dump} — elle contient les données de la base : à supprimer une fois la bascule vérifiée.`,
      );
      console.log("Ensuite : npm run db:migrate, npm test, npm run secrets:backup.");
    } else {
      throw new UsageError("usage : npm run db:bascule [-- --essai | --retour]");
    }
  } catch (error) {
    // Our own messages only: a database's could quote a connection string.
    console.error(`🛑 ${errorText(error, [UsageError, BasculeError])}`);
    process.exitCode = 1;
  }
}
