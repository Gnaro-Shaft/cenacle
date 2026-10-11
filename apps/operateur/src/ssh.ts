/**
 * The operator's only door to a server (J6f, ADR-0027): /usr/bin/ssh, no
 * shell, a short environment (no agent socket: the key file alone), a time
 * limit. Only the exit code comes back — the server's output is never read,
 * kept, nor shown. And a key is used only if no one else can read it.
 */
import { execFile } from "node:child_process";
import { statSync } from "node:fs";

export const SSH = "/usr/bin/ssh";
/** A run cut off after this is no answer: exit code -1, the action failed. */
export const SSH_TIMEOUT_MS = 120_000;

/** A regular file of mine, readable by me only (600 or 400). */
export function keyIsPrivate(path: string, uid = process.getuid?.() ?? -1): boolean {
  try {
    const s = statSync(path);
    return s.isFile() && (s.mode & 0o077) === 0 && s.uid === uid;
  } catch {
    return false;
  }
}

export function runSsh(args: readonly string[], timeoutMs = SSH_TIMEOUT_MS): Promise<number> {
  return new Promise((resolve) => {
    execFile(
      SSH,
      [...args],
      {
        timeout: timeoutMs,
        maxBuffer: 64_000,
        env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME ?? "", LANG: "C" },
      },
      (error) => {
        if (error === null) resolve(0);
        else if (typeof error.code === "number") resolve(error.code);
        else resolve(-1);
      },
    );
  });
}
