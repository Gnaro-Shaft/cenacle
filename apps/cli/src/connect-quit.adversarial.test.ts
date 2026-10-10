// Every program connects through connectOrQuit: a missing setting is said in
// one line, never as a stack trace holding the files' absolute paths.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APPS = join(import.meta.dirname, "../..");

/** The top-level lines (column 0) of the apps' sources that connect directly. */
function directConnections(): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(APPS, { recursive: true, encoding: "utf8" })) {
    if (!/\/src\/.*\.ts$/.test(entry) || /\.test\.ts$|node_modules/.test(entry)) continue;
    const lines = readFileSync(join(APPS, entry), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/^\S.*\bconnectAs(App|Executor)\(/.test(line) && !line.startsWith("import")) {
        found.push(`apps/${entry}:${i + 1}: ${line}`);
      }
    });
  }
  return found;
}

describe("the programs' connection", () => {
  it("is never made outside connectOrQuit at a program's top level", () => {
    expect(directConnections()).toEqual([]);
  });

  it.each(["status.ts", "simulate.ts"])(
    "%s without its settings: one line, exit 1, no path",
    (script) => {
      const run = spawnSync(process.execPath, [join(import.meta.dirname, script)], {
        env: {},
        encoding: "utf8",
        timeout: 20_000,
      });
      expect(run.status).toBe(1);
      expect(run.stderr).toBe(
        "🛑 Missing environment variable CENACLE_DB_APP_PASSWORD (see .env.example)\n",
      );
      expect(run.stderr).not.toContain(homedir());
    },
  );
});
