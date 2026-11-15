/**
 * The ronde's one door to the machines (ADR-0040, R2): ssh with a read-only
 * key, locked on the server to cenacle-bulletin. The one exception to "the
 * operator alone launches ssh" (ADR-0027), in this file alone, checked by the
 * operator's boundary test. Never an action key, never the operator's list:
 * the keys come from parc.local.toml.
 */
import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { MAX_BULLETIN } from "@cenacle/securite";

export const SSH = "/usr/bin/ssh";
/** The whole call: connection (ssh's own limit), the bulletin, and its two port readings. */
export const SSH_TIMEOUT_MS = 60_000;

/** One call: its exit code (-1 when cut off) and its output, capped. */
export type Run = (args: readonly string[]) => Promise<{ code: number; out: string }>;

export const runSsh: Run = (args) =>
  new Promise((resolve) => {
    execFile(
      SSH,
      [...args],
      {
        timeout: SSH_TIMEOUT_MS,
        maxBuffer: MAX_BULLETIN,
        // No agent socket, no inherited environment: the key named, nothing else.
        env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME ?? "", LANG: "C" },
      },
      (error, stdout) => {
        const out = typeof stdout === "string" ? stdout : "";
        if (error === null) resolve({ code: 0, out });
        // Cut off by the limit, or by maxBuffer: no answer worth reading.
        else if (error.killed === true || error.signal !== null) resolve({ code: -1, out: "" });
        else resolve({ code: typeof error.code === "number" ? error.code : -1, out: "" });
      },
    );
  });

/** A regular file of mine, readable by me only (600 or 400): else the key is not used. */
export function keyIsPrivate(path: string, uid = process.getuid?.() ?? -1): boolean {
  try {
    const s = statSync(path);
    return s.isFile() && (s.mode & 0o077) === 0 && s.uid === uid;
  } catch {
    return false;
  }
}
