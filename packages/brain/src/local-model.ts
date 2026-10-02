/**
 * The local model, served by LM Studio (OpenAI-compatible API) on the Mac.
 * Only this provider is registered: no cloud provider exists in this process.
 */
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
}

export interface LocalModels {
  readonly models: MutableModels;
  readonly model: Model<Api>;
}

export function localModelConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LocalModelConfig {
  const baseUrl = env.LOCAL_MODEL_BASE_URL;
  const modelId = env.LOCAL_MODEL_ID;
  if (!baseUrl || !modelId) {
    throw new Error("LOCAL_MODEL_BASE_URL and LOCAL_MODEL_ID must be set in .env");
  }
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`LOCAL_MODEL_BASE_URL must be http(s), got ${url.protocol}`);
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
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32768,
    maxTokens: 2048,
    compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" },
  };
  const provider = createProvider({
    id: "local",
    name: "Local model",
    baseUrl: config.baseUrl,
    // LM Studio needs no key, but the OpenAI client refuses to run without one:
    // a fixed placeholder, never a secret.
    auth: { apiKey: { name: "Local model", resolve: async () => ({ auth: { apiKey: "local" } }) } },
    models: [model],
    api: openAICompletionsApi(),
  });
  const models = createModels();
  models.setProvider(provider);
  return { models, model };
}
