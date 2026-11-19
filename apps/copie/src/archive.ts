/**
 * A copy, read back (ADR-0044, point 7): decrypted by age with my private key
 * (given on age's input, never in an argument, the environment or a file),
 * held in memory only, turned into SQL by the container's own pg_restore —
 * then judged line by line before anything runs it. The copy is not trusted:
 * a key stolen from the push and the public key are enough to forge one, and
 * an archive's entries carry their own SQL. Only what a real copy holds
 * passes: the four tables' COPY blocks, their sequences' setval, pg_dump's
 * own SET lines and its \restrict guard. Anything else, nothing is reloaded.
 * The errors never quote the copy: it holds the rows.
 */
import { spawn } from "node:child_process";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { COPIE_TABLES } from "@cenacle/journal";
import { type Container, CopieError, childEnv } from "./export.ts";

/** Far above a night's copy (tens of kilobytes): held in memory, never on disk. */
export const MAX_COPY_BYTES = 256 * 1024 * 1024;
const AGE_HEADER = "age-encryption.org/v1\n";
export const KEY = /^AGE-SECRET-KEY-1[0-9A-Z]{58}$/;
const TIMEOUT_MS = 5 * 60_000;

/** A regular file, under the cap, that begins as age's do: else nothing is asked. */
export function checkCopyFile(path: string): void {
  let size: number;
  try {
    const s = statSync(path);
    if (!s.isFile()) throw new CopieError("la copie n'est pas un fichier ordinaire");
    size = s.size;
  } catch (error) {
    if (error instanceof CopieError) throw error;
    throw new CopieError("la copie est introuvable");
  }
  if (size > MAX_COPY_BYTES) throw new CopieError("la copie dépasse 256 Mo : ce n'en est pas une");
  const head = Buffer.alloc(AGE_HEADER.length);
  const fd = openSync(path, "r");
  try {
    readSync(fd, head, 0, head.length, 0);
  } finally {
    closeSync(fd);
  }
  if (head.toString("latin1") !== AGE_HEADER) {
    throw new CopieError("ce fichier n'est pas une copie chiffrée par age");
  }
}

/** A child's whole output, in memory, capped; its stderr is never kept (it could quote rows). */
function collect(
  command: string,
  args: readonly string[],
  input: string | Buffer,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; out: Buffer }> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { env, stdio: ["pipe", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_COPY_BYTES) child.kill("SIGKILL");
      else chunks.push(chunk);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: -2, out: Buffer.alloc(0) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: size > MAX_COPY_BYTES ? -3 : (code ?? -1), out: Buffer.concat(chunks) });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/** The plain archive, in memory. The key goes to age's input, and nowhere else. */
export async function decrypt(age: string, key: string, file: string): Promise<Buffer> {
  if (!KEY.test(key)) throw new CopieError("ce n'est pas une clé privée age (AGE-SECRET-KEY-1…)");
  const run = await collect(age, ["--decrypt", "--identity", "-", file], `${key}\n`, childEnv());
  if (run.code !== 0 || run.out.length === 0) {
    throw new CopieError("age ne déchiffre pas cette copie avec cette clé : rien n'est restauré");
  }
  return run.out;
}

/** The archive as SQL, by the container's pg_restore: no connection, nothing written. */
export async function archiveToSql(
  docker: string,
  container: Container,
  archive: Buffer,
): Promise<string> {
  const args = ["exec", "-i", container.name, "pg_restore", "--data-only", "--file", "-"];
  const run = await collect(docker, args, archive, childEnv());
  if (run.code !== 0) {
    throw new CopieError("pg_restore ne lit pas cette copie : ce n'est pas une archive de la base");
  }
  return run.out.toString("utf8");
}

/** What a copy reloads: each table's columns, and its sequence's value. */
export interface CopyContent {
  readonly columns: ReadonlyMap<string, readonly string[]>;
  readonly sequences: ReadonlyMap<string, { readonly value: string; readonly called: boolean }>;
}

const SET_NAMES = [
  "statement_timeout",
  "lock_timeout",
  "idle_in_transaction_session_timeout",
  "transaction_timeout",
  "client_encoding",
  "standard_conforming_strings",
  "check_function_bodies",
  "xmloption",
  "client_min_messages",
  "row_security",
];
// A value quoted whole or not at all: a lone quote would open a string psql reads across lines.
const SET_LINE = new RegExp(`^SET (${SET_NAMES.join("|")}) = (?:'[A-Za-z0-9_]+'|[A-Za-z0-9_]+);$`);
const SEARCH_PATH = "SELECT pg_catalog.set_config('search_path', '', false);";
const COPY_LINE = /^COPY public\.([a-z_]+) \(([a-z_]+(?:, [a-z_]+)*)\) FROM stdin;$/;
const SETVAL =
  /^SELECT pg_catalog\.setval\('public\.([a-z_]+)', ([1-9][0-9]{0,18}), (true|false)\);$/;
const RESTRICT = /^\\(restrict|unrestrict) ([A-Za-z0-9]{1,100})$/;

const refuse = (): never => {
  throw new CopieError(
    "la copie contient autre chose que les quatre tables et leurs séquences : rien n'est rechargé",
  );
};

/**
 * Judges the script pg_restore wrote, line by line: what passes is exactly a
 * copy's shape, each table and sequence once, all four; the data inside the
 * COPY blocks is data to COPY, never SQL. Throws on anything else.
 *
 * Where psql and this judge could read a line differently, the line is
 * refused: a carriage return or a NUL anywhere (psql ends a COPY on "\.\r",
 * found by review on 19/11 — real COPY text escapes both), a data line that
 * begins with "\." without being the end; and pg_dump's \restrict guard is
 * required, first: no psql command runs inside it.
 */
export function judgeScript(script: string): CopyContent {
  if (/[\r\0]/.test(script)) refuse();
  const tables = new Set<string>(COPIE_TABLES);
  const columns = new Map<string, readonly string[]>();
  const sequences = new Map<string, { value: string; called: boolean }>();
  let guard: string | null = null;
  let unguarded = false;
  let inCopy = false;
  const lines = script.split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const line of lines) {
    if (inCopy) {
      if (line === "\\.") inCopy = false;
      else if (line.startsWith("\\.")) refuse();
      continue;
    }
    if (line === "" || line.startsWith("--")) continue;
    const meta = RESTRICT.exec(line);
    if (meta !== null) {
      // One \restrict, first; its \unrestrict last, with the same key.
      if (meta[1] === "restrict" && guard === null) guard = meta[2] ?? "";
      else if (meta[1] === "unrestrict" && guard === meta[2] && !unguarded) unguarded = true;
      else refuse();
      continue;
    }
    if (guard === null || unguarded) refuse();
    if (SET_LINE.test(line) || line === SEARCH_PATH) continue;
    const copy = COPY_LINE.exec(line);
    if (copy !== null) {
      const [, table = "", list = ""] = copy;
      if (!tables.has(table) || columns.has(table)) refuse();
      columns.set(table, list.split(", "));
      inCopy = true;
      continue;
    }
    const setval = SETVAL.exec(line);
    if (setval !== null) {
      const [, sequence = "", value = "", called = ""] = setval;
      if (!sequence.endsWith("_id_seq") || !tables.has(sequence.slice(0, -"_id_seq".length))) {
        refuse();
      }
      if (sequences.has(sequence)) refuse();
      sequences.set(sequence, { value, called: called === "true" });
      continue;
    }
    refuse();
  }
  if (inCopy || !unguarded) refuse();
  if (columns.size !== tables.size || sequences.size !== tables.size) refuse();
  return { columns, sequences };
}
