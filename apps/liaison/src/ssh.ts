/**
 * The liaison's one door to the house (ADR-0048): ssh with its own key, locked
 * on the VM to the forced command `maison-liaison`. The third exception to
 * "the operator alone launches ssh" (ADR-0027), in this file alone, checked by
 * the operator's boundary test. No agent socket, no configuration file, no
 * inherited environment; the VM's key pinned in a known_hosts of its own.
 * The demand goes on the standard input; one JSON line comes back.
 */
import { execFile } from "node:child_process";
import { statSync } from "node:fs";

export const SSH = "/usr/bin/ssh";
/** The house reads each demand again in Paperclip for `etat`: its own limit is 120 s. */
export const SSH_TIMEOUT_MS = 150_000;

export interface Porte {
  readonly hote: string;
  readonly compte: string;
  readonly cle: string;
  readonly knownHosts: string;
}

export type Commande = "deposer" | "etat";

/** One call: its exit code (-1 cut off or too long, -2 ssh could not start) and its output. */
export interface Appel {
  readonly code: number;
  readonly out: string;
}

/** Fixed options; the command word only fills SSH_ORIGINAL_COMMAND on the VM. */
export function sshArgs(p: Porte, commande: Commande): string[] {
  return [
    "-T",
    "-F",
    "/dev/null",
    "-i",
    p.cle,
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "IdentityAgent=none",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${p.knownHosts}`,
    "-o",
    "GlobalKnownHostsFile=/dev/null",
    "-o",
    "UpdateHostKeys=no",
    "-o",
    "ConnectTimeout=15",
    "-o",
    "ServerAliveInterval=10",
    "-l",
    p.compte,
    "--",
    p.hote,
    commande,
  ];
}

/** Runs ssh (or, in tests, a stand-in for it) with `input` on its standard input. */
export function appeler(
  args: readonly string[],
  input: string,
  maxOut: number,
  file: string = SSH,
  timeoutMs: number = SSH_TIMEOUT_MS,
): Promise<Appel> {
  return new Promise((resolve) => {
    const child = execFile(
      file,
      [...args],
      {
        timeout: timeoutMs,
        maxBuffer: maxOut,
        encoding: "utf8",
        env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME ?? "", LANG: "C" },
      },
      (error, stdout) => {
        const out = typeof stdout === "string" ? stdout : "";
        if (error === null) return resolve({ code: 0, out });
        // Too long an answer: cut off, like a time limit — never read.
        if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
          return resolve({ code: -1, out: "" });
        // ssh itself could not start (ENOENT, EACCES): nothing left the Mac.
        if (typeof error.code === "string") return resolve({ code: -2, out: "" });
        if (error.killed === true || error.signal !== null) return resolve({ code: -1, out: "" });
        resolve({ code: typeof error.code === "number" ? error.code : -1, out });
      },
    );
    // A closed pipe (the other end gone) is the call's failure, said by its exit code.
    child.stdin?.on("error", () => {});
    child.stdin?.end(input, "utf8");
  });
}

/** A regular file of mine, readable by me only (600 or 400): else the key is not used. */
export function keyIsPrivate(path: string, uid = process.getuid?.() ?? -1): boolean {
  try {
    const s = statSync(path);
    return s.isFile() && (s.mode & 0o077) === 0 && s.uid === uid;
  } catch {
    return false;
  }
}
