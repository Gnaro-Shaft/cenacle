// Ollama can relay a model it does not hold to its own cloud. Neither a cloud
// model nor Ollama's cloud API may be configured as "the local model" (ADR-0003):
// the program refuses to start, whatever the spelling.
import { UsageError } from "@cenacle/core";
import { describe, expect, it } from "vitest";
import { localModelConfigFromEnv } from "./local-model.ts";

const LOCAL = "http://127.0.0.1:11434/v1";

describe("localModelConfigFromEnv", () => {
  it.each([
    "qwen3.8:27b",
    "qwen/qwen3.8-27b",
    "qwen3.8:27b-origine",
    "cloudy-model:7b",
    "mycloudmodel",
  ])("accepts the local model %j", (modelId) => {
    expect(
      localModelConfigFromEnv({ LOCAL_MODEL_BASE_URL: LOCAL, LOCAL_MODEL_ID: modelId }),
    ).toEqual({ baseUrl: LOCAL, modelId });
  });

  it.each([
    "gpt-oss:120b-cloud",
    "qwen3-coder:480b-cloud",
    "glm-4.6:cloud",
    "kimi-k2:1T-CLOUD",
    "cloud/qwen3.8",
    "deepseek-v3.1:671b-cloud ",
  ])("refuses the cloud model %j", (modelId) => {
    const read = () =>
      localModelConfigFromEnv({ LOCAL_MODEL_BASE_URL: LOCAL, LOCAL_MODEL_ID: modelId });
    expect(read).toThrow(UsageError);
    expect(read).toThrow(/cloud model/);
  });

  it.each([
    "https://ollama.com/v1",
    "https://OLLAMA.COM/v1",
    "https://api.ollama.com/v1",
    "https://ollama.com./v1",
    "https://user@ollama.com:443/v1",
  ])("refuses Ollama's cloud API %j", (baseUrl) => {
    const read = () =>
      localModelConfigFromEnv({ LOCAL_MODEL_BASE_URL: baseUrl, LOCAL_MODEL_ID: "qwen3.8:27b" });
    expect(read).toThrow(UsageError);
    expect(read).toThrow(/Ollama's cloud/);
  });

  it("a host that only ends like it is not Ollama's cloud", () => {
    const baseUrl = "http://notollama.com.example.test:11434/v1";
    expect(
      localModelConfigFromEnv({ LOCAL_MODEL_BASE_URL: baseUrl, LOCAL_MODEL_ID: "m" }).baseUrl,
    ).toBe(baseUrl);
  });

  it("the error never quotes the configured value", () => {
    try {
      localModelConfigFromEnv({ LOCAL_MODEL_BASE_URL: LOCAL, LOCAL_MODEL_ID: "secret-name:cloud" });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("secret-name");
    }
  });
});
