// Shared by the server-script tests (J6f, ADR-0027): the repository root, whether
// a throwaway Ubuntu can be run (Docker absent on the CI: those tests skip), and
// a scratch directory removed after the file's tests.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

export const ROOT = join(import.meta.dirname, "..", "..", "..");

export const docker = (() => {
  try {
    execFileSync("docker", ["image", "inspect", "ubuntu:24.04"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

export function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cenacle-script-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
