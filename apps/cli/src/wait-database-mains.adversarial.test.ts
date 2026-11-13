// Every program run by launchd waits for its database before its first query
// (lot C, 13/11): its first connection goes through waitForDatabase.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APPS = join(import.meta.dirname, "../..");
const SERVICES = [
  "iris",
  "server",
  "telegram",
  "cto",
  "veille",
  "securite",
  "operateur",
  "prospection",
  "executor",
];

describe("the programs' first connection", () => {
  it.each(SERVICES)("%s waits for the base", (app) => {
    const main = readFileSync(join(APPS, app, "src", "main.ts"), "utf8");
    const first = /^const sql = (.*)$/m.exec(main)?.[1] ?? "";
    expect(first).toMatch(/^await waitForDatabase\(connectOrQuit\((?:"executor")?\)\);$/);
    // Before anything else touches the base: no query nor lock above that line.
    const before = main.slice(0, main.indexOf("const sql = "));
    expect(before).not.toMatch(/connectOrQuit\("lock"\)|sql`|holdSingleInstance\(/);
  });
});
