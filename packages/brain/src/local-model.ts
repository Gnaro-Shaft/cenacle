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
  return { baseUrl: baseUrl.replace(/\/$/, ""), modelId };
}

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
  return { models, model };
}
