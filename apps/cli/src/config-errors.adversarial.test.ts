// A missing setting is said in full: the scripts print a UsageError's
// message, and only the name of any other error. And the draft bench says a
// crashed scenario by the error's name only, as its comment promises.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { localModelConfigFromEnv } from "@cenacle/brain";
import { errorText, UsageError } from "@cenacle/core";
import { testMailboxConfigFromEnv } from "@cenacle/mail";
import { describe, expect, it } from "vitest";

const thrown = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("nothing was thrown");
};

describe("a missing setting is named in full", () => {
  it.each([
    ["no local model at all", {}],
    ["a base URL without a model", { LOCAL_MODEL_BASE_URL: "http://127.0.0.1:1234/v1" }],
    ["an empty model id", { LOCAL_MODEL_BASE_URL: "http://127.0.0.1:1234/v1", LOCAL_MODEL_ID: "" }],
  ])("the local model: %s", (_label, env) => {
    const error = thrown(() => localModelConfigFromEnv(env));
    expect(error).toBeInstanceOf(UsageError);
    expect(errorText(error)).toBe("LOCAL_MODEL_BASE_URL and LOCAL_MODEL_ID must be set in .env");
  });

  it("the local model's scheme, without the rest of the URL", () => {
    const env = {
      LOCAL_MODEL_BASE_URL: "ftp://someone@models.example.test/v1",
      LOCAL_MODEL_ID: "m",
    };
    const text = errorText(thrown(() => localModelConfigFromEnv(env)));
    expect(text).toBe("LOCAL_MODEL_BASE_URL must be http(s), got ftp:");
    expect(text).not.toMatch(/someone|example\.test/);
  });

  it("an unreadable local model URL is named, not quoted", () => {
    const env = { LOCAL_MODEL_BASE_URL: "not a url someone@example.test", LOCAL_MODEL_ID: "m" };
    const text = errorText(thrown(() => localModelConfigFromEnv(env)));
    expect(text).toBe("TypeError");
  });

  it.each([
    ["missing", {}],
    ["empty", { CENACLE_TEST_MAIL_PASSWORD: "" }],
  ])("the test mailbox's password, %s", (_label, env) => {
    const error = thrown(() => testMailboxConfigFromEnv(env));
    expect(error).toBeInstanceOf(UsageError);
    expect(errorText(error)).toBe("CENACLE_TEST_MAIL_PASSWORD is missing (see .env.example)");
  });
});

describe("the draft bench on a crashed scenario", () => {
  it("keeps the error's name only, never its message", () => {
    const source = readFileSync(join(import.meta.dirname, "draft-bench/bench.ts"), "utf8");
    expect(source).not.toMatch(/\.message\b/);
    expect(source).toMatch(/const why = errorText\(error\);/);
  });
});
