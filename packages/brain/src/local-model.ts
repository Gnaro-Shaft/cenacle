/**
 * The local model, served by Ollama (OpenAI-compatible API) on the Mac
 * (ADR-0028; LM Studio until 2026-10-21).
 * Only this provider is registered: no cloud provider exists in this process.
 */
import { UsageError } from "@cenacle/core";
import {
  type Api,
  createModels,
  createProvider,
  type Model,
  type MutableModels,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

export interface LocalModelConfig {
  readonly baseUrl: string;
  readonly modelId: string;
  /**
   * What the program may send and receive, in tokens. Iris's short questions
   * keep the defaults; the CTO's documentation needs a larger window (it must
   * stay within the context Ollama loads, OLLAMA_CONTEXT_LENGTH).
   */
  readonly contextWindow?: number;
  readonly maxTokens?: number;
}

export interface LocalModels {
  readonly models: MutableModels;
  readonly model: Model<Api>;
}

const CLOUD_MODEL = /(^|[^a-z0-9])cloud($|[^a-z0-9])/i;
const CLOUD_HOST = /(^|\.)ollama\.com\.?$/i;

/**
 * This machine, and nothing else (lot D, 13/11): the model must be on the
 * Mac. Before, only Ollama's cloud was refused — any other host passed, an
 * online model's API included. The URL parser has already normalised the
 * name (`127.1` → `127.0.0.1`, IPv6 in brackets). A model on another of my
 * machines would need its own ADR first.
 */
export function isThisMachine(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const octets = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  return octets !== null && octets.slice(1).every((o) => Number(o) <= 255);
}

export function localModelConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LocalModelConfig {
  const baseUrl = env.LOCAL_MODEL_BASE_URL;
  const modelId = env.LOCAL_MODEL_ID;
  if (!baseUrl || !modelId) {
    throw new UsageError("LOCAL_MODEL_BASE_URL and LOCAL_MODEL_ID must be set in .env");
  }
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UsageError(`LOCAL_MODEL_BASE_URL must be http(s), got ${url.protocol}`);
  }
  // Ollama can relay a model it does not hold to its own cloud: such a model is
  // named "…:cloud" or "…-cloud", and its API is ollama.com. Either would send
  // a mail's content off the Mac (ADR-0003): refused here, behind the server's
  // own OLLAMA_NO_CLOUD.
  if (CLOUD_MODEL.test(modelId)) {
    throw new UsageError("LOCAL_MODEL_ID names a cloud model: only a local model is allowed");
  }
  if (CLOUD_HOST.test(url.hostname)) {
    throw new UsageError("LOCAL_MODEL_BASE_URL is Ollama's cloud: only a local server is allowed");
  }
  if (!isThisMachine(url.hostname)) {
    throw new UsageError(
      "LOCAL_MODEL_BASE_URL must be this machine (localhost, 127.x.x.x or [::1]): only a local model is allowed",
    );
  }
  return { baseUrl: baseUrl.replace(/\/$/, ""), modelId };
}

/** The model's HTTP calls: like fetch, but a redirect fails instead of being followed. */
export const noRedirect: typeof fetch = (input, init) =>
  fetch(input, { ...init, redirect: "error" });

export function createLocalModels(config: LocalModelConfig): LocalModels {
  const model: Model<"openai-completions"> = {
    id: config.modelId,
    name: `${config.modelId} (local)`,
    api: "openai-completions",
    provider: "local",
    baseUrl: config.baseUrl,
    // Hidden reasoning is switched OFF: measured on 2026-10-02, it was 85-96% of
    // the tokens and made latency swing from 8 to 34 s for a one-line answer.
    // LM Studio, then Ollama, honour `reasoning_effort: "none"` (measured again
    // on 2026-10-20, docs/mesures/bascule-qwen36.md); a reasoning that still
    // leaks before `</think>` is dropped by answer-text.ts. Declaring the model as "reasoning" is what lets pi send that value.
    reasoning: true,
    thinkingLevelMap: { off: "none" },
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.contextWindow ?? 32768,
    maxTokens: config.maxTokens ?? 2048,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      maxTokensField: "max_tokens",
    },
  };
  const provider = createProvider({
    id: "local",
    name: "Local model",
    baseUrl: config.baseUrl,
    // A local Ollama needs no key, but the OpenAI client refuses to run without one:
    // a fixed placeholder, never a secret.
    auth: { apiKey: { name: "Local model", resolve: async () => ({ auth: { apiKey: "local" } }) } },
    models: [model],
    api: openAICompletionsApi(),
  });
  const models = createModels();
  models.setProvider(provider);
  // Never a redirect (lot F5, 13/11): the address is checked to be this
  // machine (isThisMachine), but a local server answering 3xx would have led
  // the request — a mail's content — elsewhere. A redirect is an error.
  const stream = models.streamSimple.bind(models);
  models.streamSimple = (m, context, options) =>
    stream(m, context, { ...options, fetch: noRedirect });
  return { models, model };
}
