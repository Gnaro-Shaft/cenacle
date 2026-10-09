// A program that cannot connect says why in one line and exits with 1. No
// stack trace: it would print the files' absolute paths, the home folder's
// name in them, and launchd would keep them in a program's log file.
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { UsageError } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import { connectOrQuit } from "./connect.ts";
import { appUrlFromEnv, EXECUTOR_PASSWORD_VAR, migrate, requireEnv } from "./migrate.ts";

// Synthetic values only.
const GOOD = "synthetic_password_0123456789";
const OTHER = "another_synthetic_pw_98765";

/** Runs connectOrQuit in a fresh node, with only the given environment. */
function quit(role: "app" | "executor", env: Record<string, string>) {
  const connect = join(import.meta.dirname, "connect.ts");
  const code = `const { connectOrQuit } = await import(${JSON.stringify(connect)});
const sql = connectOrQuit(${JSON.stringify(role)}); await sql.end(); console.log("connected");`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    env,
    encoding: "utf8",
    timeout: 20_000,
  });
}

describe("a missing or malformed database setting", () => {
  it("is a UsageError, said by its variable's name", () => {
    expect(() => appUrlFromEnv("cenacle", {})).toThrow(UsageError);
    expect(() => appUrlFromEnv("cenacle", { CENACLE_DB_APP_PASSWORD: "" })).toThrow(
      "Missing environment variable CENACLE_DB_APP_PASSWORD (see .env.example)",
    );
    const name = "CENACLE_SYNTHETIC_NEVER_SET";
    expect(() => requireEnv(name)).toThrow(UsageError);
  });

  it.each([
    ["a short app password", { appPassword: "short", executorPassword: GOOD }],
    ["a password with a quote", { appPassword: `${GOOD}'`, executorPassword: OTHER }],
    ["the same password twice", { appPassword: GOOD, executorPassword: GOOD }],
  ])("refuses %s before connecting, and never quotes it", async (_label, passwords) => {
    const error = await migrate({ ownerUrl: "postgres://nobody@127.0.0.1:1/none", ...passwords })
      .then(() => null)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).not.toContain(passwords.appPassword);
  });
});

describe("connectOrQuit", () => {
  it.each([
    ["app", {}, "CENACLE_DB_APP_PASSWORD"],
    ["app", { CENACLE_DB_APP_PASSWORD: "" }, "CENACLE_DB_APP_PASSWORD"],
    ["executor", { CENACLE_DB_APP_PASSWORD: GOOD }, EXECUTOR_PASSWORD_VAR],
  ] as const)("as %s with %j: one line naming %s, exit 1", (role, env, name) => {
    const run = quit(role, env);
    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toBe(`🛑 Missing environment variable ${name} (see .env.example)\n`);
    expect(run.stderr).not.toContain(homedir());
    expect(run.stderr).not.toMatch(/\n\s+at |file:\/\//);
  });

  it("does not stand in the way of a program whose settings are there", () => {
    const run = quit("executor", { [EXECUTOR_PASSWORD_VAR]: OTHER });
    expect(run.stderr).toBe("");
    expect(run.stdout).toBe("connected\n");
    expect(run.status).toBe(0);
  });

  it("returns a lazy connection in process, without quitting", async () => {
    const before = process.env.CENACLE_DB_APP_PASSWORD;
    process.env.CENACLE_DB_APP_PASSWORD = GOOD;
    try {
      const sql = connectOrQuit();
      await sql.end();
    } finally {
      if (before === undefined) delete process.env.CENACLE_DB_APP_PASSWORD;
      else process.env.CENACLE_DB_APP_PASSWORD = before;
    }
  });
});
