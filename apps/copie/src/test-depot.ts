// Shared by the backup node's tests (ADR-0044, points 4 and 5): a throwaway
// Debian with rsync's rrsync and python3 (the push test's image), with
// deploy/serveurs mounted read-only, and a stand-in for systemctl — there is
// no systemd in a container: it notes each call and, asked to start the
// watcher's unit, runs the script itself. Skipped where Docker is absent (the CI).
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";

export const ROOT = join(import.meta.dirname, "..", "..", "..");
export const IMAGE = "cenacle-test-rrsync:1";
export const STORE = "/var/backups/cenacle-copie";
export const STATE = "/var/lib/copie-cenacle";
export const WATCHER = "/usr/local/sbin/veiller-copie-cenacle";

const BASE = process.env.CENACLE_TEST_DEBIAN_IMAGE ?? "debian:stable-slim";

/** As the server-script tests: Docker and the base image already here (never on the CI). */
export const docker = (() => {
  try {
    execFileSync("docker", ["image", "inspect", BASE], { stdio: "ignore", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
})();

/** The push test's image, built once from Debian's own packages. */
export function buildImage(): void {
  const dockerfile = [
    "ARG BASE",
    "FROM ${BASE}",
    "RUN apt-get update && apt-get install -y --no-install-recommends openssh-server rsync python3 && rm -rf /var/lib/apt/lists/* && mkdir -p /run/sshd",
  ].join("\n");
  execFileSync("docker", ["build", "-q", "--build-arg", `BASE=${BASE}`, "-t", IMAGE, "-"], {
    input: dockerfile,
    stdio: ["pipe", "ignore", "inherit"],
  });
}

/** A word for bash, whatever it holds. */
export const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

const STUB = [
  "#!/bin/sh",
  'echo "$*" >> /var/log/systemctl-stub',
  'if [ "$1" = start ] && [ "$2" = veiller-copie-cenacle.service ]; then exec /usr/local/sbin/veiller-copie-cenacle; fi',
  "exit 0",
].join("\n");

export interface Node {
  readonly name: string;
  /** bash -c, as root unless `user` is given. */
  sh(command: string, user?: string): { code: number; out: string };
  stop(): void;
}

/** A container, deploy/serveurs at /d, systemctl stood in; `publish` exposes sshd. */
export function startNode(publish = false): Node {
  const name = `cenacle-depot-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
  const args = ["run", "-d", "--name", name, "-v", `${join(ROOT, "deploy", "serveurs")}:/d:ro`];
  if (publish) args.push("-p", "127.0.0.1::22");
  execFileSync("docker", [...args, IMAGE, "sleep", "infinity"], { stdio: "ignore" });
  const sh = (command: string, user?: string) => {
    const run = spawnSync(
      "docker",
      ["exec", ...(user ? ["-u", user] : []), name, "bash", "-c", command],
      { encoding: "utf8", timeout: 60_000 },
    );
    return { code: run.status ?? -1, out: `${run.stdout ?? ""}${run.stderr ?? ""}` };
  };
  sh(`printf '%s\\n' ${q(STUB)} > /usr/local/bin/systemctl && chmod 755 /usr/local/bin/systemctl`);
  return { name, sh, stop: () => spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" }) };
}
