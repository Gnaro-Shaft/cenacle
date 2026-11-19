// Shared by the homelab's tests (ADR-0045): a throwaway Debian with what the
// scripts of deploy/homelab need (rsync, zstd, strace for the fsync fault,
// python3 for the backup watch), deploy/ mounted read-only. No network once
// built; skipped where Docker or the base image is absent (the CI).
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";

export const ROOT = join(import.meta.dirname, "..", "..", "..");
export const IMAGE = "cenacle-test-homelab:1";
const BASE = process.env.CENACLE_TEST_DEBIAN_IMAGE ?? "debian:stable-slim";

/** Docker and the base image already here (never on the CI): else the tests are skipped. */
export const docker = (() => {
  try {
    execFileSync("docker", ["image", "inspect", BASE], { stdio: "ignore", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
})();

/** The image, built once from Debian's own packages. */
export function buildImage(): void {
  const dockerfile = [
    "ARG BASE",
    "FROM ${BASE}",
    "RUN apt-get update && apt-get install -y --no-install-recommends rsync zstd strace python3 && rm -rf /var/lib/apt/lists/*",
  ].join("\n");
  execFileSync("docker", ["build", "-q", "--build-arg", `BASE=${BASE}`, "-t", IMAGE, "-"], {
    input: dockerfile,
    stdio: ["pipe", "ignore", "inherit"],
  });
}

/** A word for bash, whatever it holds. */
export const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export interface Box {
  /** bash -c as root, in the container; stdout and stderr apart. */
  sh(command: string): { code: number; out: string; err: string };
  stop(): void;
}

/** A container, deploy/ at /d (read-only), no network; strace may trace (the fsync fault). */
export function startBox(): Box {
  const name = `cenacle-homelab-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
  const args = ["run", "-d", "--name", name, "--network", "none", "--cap-add", "SYS_PTRACE"];
  args.push("-v", `${join(ROOT, "deploy")}:/d:ro`, IMAGE, "sleep", "infinity");
  execFileSync("docker", args, { stdio: "ignore" });
  return {
    sh(command) {
      const run = spawnSync("docker", ["exec", name, "bash", "-c", command], {
        encoding: "utf8",
        timeout: 300_000,
      });
      return { code: run.status ?? -1, out: run.stdout ?? "", err: run.stderr ?? "" };
    },
    stop: () => spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" }),
  };
}
