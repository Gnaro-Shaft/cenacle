// S1: no program starts with a secret that is not its own, and splitting .env
// moves each secret once, keeps everything else, and never shows a value.
import { describe, expect, it } from "vitest";
import { refuseForeignSecrets, SecretPlacementError, splitEnv } from "./secrets.ts";

const ALL = {
  CENACLE_DB_OWNER_PASSWORD: "owner-secret-value",
  CENACLE_TEST_MAIL_PASSWORD: "mail-secret-value",
  CENACLE_MAIL_KEY: "k".repeat(64),
  TELEGRAM_BOT_TOKEN: "123:telegram-secret",
  GRAFANA_ADMIN_PASSWORD: "grafana-secret",
  CENACLE_ACCEPT_PRIVATE_KEY: "private-key-value",
  CENACLE_DB_EXECUTOR_PASSWORD: "executor-secret",
};

describe("each program holds its own secrets, and only them", () => {
  it.each([
    ["Iris", ["mail", "telegram"]],
    ["the page's server", ["mail", "page"]],
    ["the executor", ["mail", "executor"]],
    ["the Telegram bot", ["telegram"]],
  ] as const)("%s refuses every other family, the database owner first", (program, allowed) => {
    expect(() => refuseForeignSecrets(program, allowed, ALL)).toThrow(SecretPlacementError);
    expect(() => refuseForeignSecrets(program, allowed, ALL)).toThrow(/CENACLE_DB_OWNER_PASSWORD/);
    const own = Object.fromEntries(
      Object.entries(ALL).filter(([name]) =>
        allowed.some((f) =>
          ({
            mail: ["CENACLE_TEST_MAIL_PASSWORD", "CENACLE_MAIL_KEY"],
            telegram: ["TELEGRAM_BOT_TOKEN"],
            page: ["CENACLE_ACCEPT_PRIVATE_KEY"],
            executor: ["CENACLE_DB_EXECUTOR_PASSWORD"],
          })[f].includes(name),
        ),
      ),
    );
    expect(() =>
      refuseForeignSecrets(program, allowed, { ...own, CENACLE_DB_PORT: "1" }),
    ).not.toThrow();
  });

  it("names the variables, never their values; an empty value is not a secret held", () => {
    try {
      refuseForeignSecrets("Iris", ["mail"], { TELEGRAM_BOT_TOKEN: "123:telegram-secret" });
    } catch (error) {
      expect(String(error)).toContain("TELEGRAM_BOT_TOKEN");
      expect(String(error)).not.toContain("telegram-secret");
    }
    expect(() => refuseForeignSecrets("Iris", [], { TELEGRAM_BOT_TOKEN: "" })).not.toThrow();
  });
});

describe("splitting .env", () => {
  const env = [
    "# Copy to .env",
    "CENACLE_DB_PORT=55432",
    "CENACLE_DB_OWNER_PASSWORD=owner-secret-value",
    "",
    "export TELEGRAM_BOT_TOKEN=123:telegram-secret",
    "TELEGRAM_ALLOWED_CHAT_ID=42",
    "CENACLE_MAIL_KEY=" + "k".repeat(64),
    "CENACLE_TEST_MAIL_PASSWORD = spaced",
    "GRAFANA_ADMIN_PASSWORD=grafana-secret",
  ].join("\n");

  it("moves each secret to its family, keeps the rest in order", () => {
    const plan = splitEnv(env);
    expect(plan.remaining).toEqual([
      "# Copy to .env",
      "CENACLE_DB_PORT=55432",
      "",
      "TELEGRAM_ALLOWED_CHAT_ID=42",
    ]);
    expect(plan.moved.owner).toEqual(["CENACLE_DB_OWNER_PASSWORD=owner-secret-value"]);
    expect(plan.moved.telegram).toEqual(["export TELEGRAM_BOT_TOKEN=123:telegram-secret"]);
    expect(plan.moved.mail).toHaveLength(2);
    expect(plan.moved.obs).toEqual(["GRAFANA_ADMIN_PASSWORD=grafana-secret"]);
  });

  it("the summary shows names only, never a value", () => {
    const summary = JSON.stringify(splitEnv(env).summary);
    expect(summary).toContain("CENACLE_DB_OWNER_PASSWORD");
    for (const value of ["owner-secret-value", "telegram-secret", "grafana-secret", "spaced"]) {
      expect(summary).not.toContain(value);
    }
  });

  it("refuses a secret defined twice: which one would win is not for the script to guess", () => {
    expect(() => splitEnv("CENACLE_MAIL_KEY=a\nCENACLE_MAIL_KEY=b")).toThrow(/defined twice/);
  });

  it("a .env without secrets moves nothing", () => {
    expect(splitEnv("CENACLE_DB_PORT=1\n").moved).toEqual({});
  });
});
