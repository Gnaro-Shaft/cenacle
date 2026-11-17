/**
 * The copy itself (ADR-0044, points 1 and 2): pg_dump of the four tables'
 * data, run inside the database's container through its own network address
 * (never a local connection, which the image trusts without a password), as
 * cenacle_copie, its password passed by name;
 * pg_dump's output goes straight into age's input — the plain dump is never
 * a file, never on the network. Only age's output, encrypted for a public
 * key the Mac holds no private half of, is written.
 */
import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readSync, statSync, unlinkSync } from "node:fs";
import { COPIE_ROLE, COPIE_TABLES } from "@cenacle/journal";

export class CopieError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CopieError";
  }
}

/** The tools, by absolute path: launchd's PATH holds node's folder and the system's only. */
export const TOOLS = {
  docker: ["/usr/local/bin/docker", "/opt/homebrew/bin/docker", "/usr/bin/docker"],
  age: ["/opt/homebrew/bin/age", "/usr/local/bin/age", "/usr/bin/age"],
  // A real rsync 3 (rrsync's options): never macOS's openrsync, checked by its version.
  rsync: ["/opt/homebrew/bin/rsync", "/usr/local/bin/rsync", "/usr/bin/rsync"],
} as const;

/** The first of the candidates that exists and passes `accept`, or null. */
export function findTool(
  candidates: readonly string[],
  accept: (path: string) => boolean = () => true,
): string | null {
  return candidates.find((p) => existsSync(p) && accept(p)) ?? null;
}

/** rsync 3 or later, not openrsync. */
export function isRealRsync(path: string): boolean {
  try {
    const v = execFileSync(path, ["--version"], { encoding: "utf8", timeout: 5000 });
    return /^rsync\s+version\s+([3-9]|\d{2,})\./.test(v);
  } catch {
    return false;
  }
}

/** What docker and age are given: no DOCKER_HOST, no agent socket, nothing inherited. */
function childEnv(): NodeJS.ProcessEnv {
  return { PATH: "/usr/bin:/bin", HOME: process.env.HOME ?? "", LANG: "C" };
}

/** The database's container: its name, and its own address on its network. */
export interface Container {
  readonly name: string;
  readonly address: string;
}

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/**
 * The database's container, found by its published port (exactly one, or
 * none), with its address on its network — never a loopback one.
 */
export function findContainer(docker: string, port: string): Container | null {
  try {
    // The same reduced environment as the export: one daemon, the same for both.
    const run = (args: string[]) =>
      execFileSync(docker, args, { encoding: "utf8", timeout: 15_000, env: childEnv() });
    const names = run(["ps", "--filter", `publish=${port}`, "--format", "{{.Names}}"])
      .split("\n")
      .filter((n) => n !== "");
    const [name] = names;
    if (names.length !== 1 || name === undefined || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) {
      return null;
    }
    const format = "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}";
    const address = run(["inspect", "--format", format, name])
      .split(/\s+/)
      .find((a) => IPV4.test(a) && !a.startsWith("127."));
    return address === undefined ? null : { name, address };
  } catch {
    return null;
  }
}

/**
 * pg_dump's arguments: through the container's own network address, so
 * that the password is asked and checked — the image trusts every local
 * connection, the socket's and 127.0.0.1's alike (`trust` in its pg_hba),
 * and asks for a password from any other address. As the copy's role, the
 * four tables' data and nothing else. The password goes by name only
 * (`-e PGPASSWORD`): never in an argument, which any process could read.
 */
export function dumpArgs(container: Container, database: string): string[] {
  if (!IPV4.test(container.address) || container.address.startsWith("127.")) {
    throw new CopieError("l'adresse du conteneur n'est pas une adresse de son réseau");
  }
  return [
    "exec",
    "-e",
    "PGPASSWORD",
    container.name,
    "pg_dump",
    "-h",
    container.address,
    "-U",
    COPIE_ROLE,
    "-d",
    database,
    "--data-only",
    "--format=custom",
    "--no-password",
    ...COPIE_TABLES.flatMap((t) => ["--table", `public.${t}`]),
  ];
}

const AGE_HEADER = "age-encryption.org/v1\n";
/** The whole copy, export and encryption, at most this long. */
export const DUMP_TIMEOUT_MS = 10 * 60_000;
/** Below this, age had nothing to encrypt: a custom archive alone is several kilobytes. */
const MIN_COPY_BYTES = 1024;

export interface DumpOptions {
  readonly docker: string;
  readonly age: string;
  readonly container: Container;
  readonly database: string;
  readonly password: string;
  readonly recipient: string;
  /** Where age writes the encrypted copy; removed if anything fails. */
  readonly out: string;
  readonly timeoutMs?: number;
}

function exitOf(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve) => {
    child.on("error", () => resolve(-2));
    child.on("close", (code) => resolve(code ?? -1));
  });
}

function startsWithAgeHeader(path: string): boolean {
  const head = Buffer.alloc(AGE_HEADER.length);
  const fd = openSync(path, "r");
  try {
    readSync(fd, head, 0, head.length, 0);
  } finally {
    closeSync(fd);
  }
  return head.toString("latin1") === AGE_HEADER;
}

/** Exports and encrypts, or throws — leaving no file behind. Returns the copy's size. */
export async function dumpEncrypted(o: DumpOptions): Promise<number> {
  const env = childEnv();
  // stderr ignored: never copied into a log (it could name a table or a row).
  const dump = spawn(o.docker, dumpArgs(o.container, o.database), {
    env: { ...env, PGPASSWORD: o.password },
    stdio: ["ignore", "pipe", "ignore"],
  });
  const age = spawn(o.age, ["--encrypt", "--recipient", o.recipient, "--output", o.out], {
    env,
    stdio: [dump.stdout, "ignore", "ignore"],
  });
  // age holds the pipe now; this process keeps no end of it (it would never
  // see its end, and the plain dump never passes through here).
  dump.stdout?.destroy();
  const timer = setTimeout(() => {
    dump.kill("SIGKILL");
    age.kill("SIGKILL");
  }, o.timeoutMs ?? DUMP_TIMEOUT_MS);
  const [dumped, encrypted] = await Promise.all([exitOf(dump), exitOf(age)]);
  clearTimeout(timer);
  const fail = (why: string): never => {
    if (existsSync(o.out)) unlinkSync(o.out);
    throw new CopieError(why);
  };
  // age first: a failing age breaks pg_dump's pipe, and pg_dump would take the blame.
  if (encrypted !== 0) fail(`le chiffrement (age) a échoué (code ${encrypted}) : rien ne part`);
  if (dumped !== 0) fail(`l'export (pg_dump) a échoué (code ${dumped}) : rien ne part`);
  if (!existsSync(o.out)) fail("le chiffrement (age) n'a rien écrit : rien ne part");
  if (!startsWithAgeHeader(o.out)) fail("la copie n'est pas chiffrée : rien ne part");
  const size = statSync(o.out).size;
  if (size < MIN_COPY_BYTES) fail("la copie chiffrée est vide : rien ne part");
  return size;
}
