/**
 * The copy's one door to the backup node (ADR-0044, point 4): rsync over ssh
 * with the push key, which the node locks on `rrsync -wo -no-del
 * -no-overwrite <arrival>` — it can write there, and nothing else. The
 * second exception to "the operator alone launches ssh" (ADR-0027), in this
 * file alone, checked by the operator's boundary test. The node's identity
 * is its fingerprint pinned in Cénacle's own known_hosts, never one learned
 * on the way; no agent socket, no ssh setting of the Mac's.
 */
import { execFile } from "node:child_process";
import { basename } from "node:path";
import type { CopieConfig } from "./config.ts";

export const SSH = "/usr/bin/ssh";
/** The whole push: connection (ssh's own limit) and transfer. */
export const PUSH_TIMEOUT_MS = 5 * 60_000;
/** The copy's name: the day, and a part drawn at random (ADR-0044, point 4). */
export const COPY_NAME = /^cenacle-\d{4}-\d{2}-\d{2}-[0-9a-f]{16}\.age$/;

/** The ssh command rsync runs, one word per option: no path here has a space (config.ts). */
export function sshCommand(c: CopieConfig, key: string): string {
  return [
    SSH,
    "-T",
    "-F",
    "/dev/null",
    "-i",
    key,
    "-p",
    String(c.port),
    "-l",
    c.account,
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "IdentityAgent=none",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${c.knownHosts}`,
    "-o",
    "GlobalKnownHostsFile=/dev/null",
    "-o",
    "UpdateHostKeys=no",
    "-o",
    "ConnectTimeout=15",
    "-o",
    "ServerAliveInterval=10",
  ].join(" ");
}

/**
 * One file, to the root of the arrival (rrsync fixes the folder): no
 * --delete, no reading back, and nothing but the file named.
 */
export function rsyncArgs(c: CopieConfig, key: string, file: string): string[] {
  if (!COPY_NAME.test(basename(file))) throw new Error("not a copy's name");
  return ["--timeout=120", "-e", sshCommand(c, key), "--", file, `${c.address}:`];
}

/** rsync's exit code: -1 when cut off, -2 when it could not start. */
export type Push = (rsync: string, args: readonly string[]) => Promise<number>;

export const runPush: Push = (rsync, args) =>
  new Promise((resolve) => {
    execFile(
      rsync,
      [...args],
      {
        timeout: PUSH_TIMEOUT_MS,
        // No agent socket, no inherited environment: the key named, nothing else.
        env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME ?? "", LANG: "C" },
      },
      (error) => {
        if (error === null) resolve(0);
        else if (typeof error.code === "string") resolve(-2);
        else if (error.killed === true || error.signal !== null) resolve(-1);
        else resolve(typeof error.code === "number" ? error.code : -1);
      },
    );
  });
