// The real script, read by the real reader (ADR-0039): what
// deploy/serveurs/cenacle-bulletin recites on a Linux machine is a bulletin
// parseBulletin accepts whole. On Linux (the CI) it runs on the host; on the
// Mac, in a throwaway Debian container (the script reads /proc).
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBulletin } from "./bulletin.ts";

const SCRIPT = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "deploy",
  "serveurs",
  "cenacle-bulletin",
);
const IMAGE = process.env.CENACLE_TEST_DEBIAN_IMAGE ?? "debian:stable-slim";

function recite(): string {
  if (process.platform === "linux") return execFileSync("bash", [SCRIPT], { encoding: "utf8" });
  const volume = `cenacle-bulletin-test-${process.pid}`;
  try {
    return execFileSync(
      "docker",
      ["run", "--rm", "-v", `${volume}:/srv`, "-v", `${SCRIPT}:/b:ro`, IMAGE, "bash", "/b"],
      { encoding: "utf8" },
    );
  } finally {
    execFileSync("docker", ["volume", "rm", "-f", volume], { stdio: "ignore" });
  }
}

describe("cenacle-bulletin, recited on a Linux machine", () => {
  it("is read whole: its measures are there and make sense", () => {
    const b = parseBulletin(recite());
    expect(b.version).toBe(2);
    expect(b.health).not.toBeNull();
    expect(b.host).not.toBe("");
    expect(Math.abs(b.at - Date.now())).toBeLessThan(5 * 60_000);
    expect(b.cpus).toBeGreaterThan(0);
    expect(b.load).not.toBeNull();
    expect(b.memory?.total).toBeGreaterThan(0);
    expect(b.memory?.available).toBeLessThanOrEqual(b.memory?.total ?? 0);
    expect(b.disks.length).toBeGreaterThan(0);
    for (const d of b.disks) expect(d.percent).toBeLessThanOrEqual(100);
  }, 120_000);
});
