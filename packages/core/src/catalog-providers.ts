import type { ProviderDef, ModelDef } from "./catalog"

const textOnly: ModelDef["capabilities"] = ["text"]
const textAndImage: ModelDef["capabilities"] = ["text", "image-input"]

export const BUILTIN_PROVIDERS: Array<typeof ProviderDef.Type> = [
  {
    id: "anthropic",
    label: "Anthropic",
    capabilities: ["streaming", "vision", "tools", "reasoning"],
    authMethods: [{ type: "api" as const, key: "ANTHROPIC_API_KEY", env: "ANTHROPIC_API_KEY" }],
    models: [
      { id: "claude-sonnet-4-20250514", provider: "anthropic", label: "Claude Sonnet 4", contextWindow: 200000, maxOutputTokens: 64000, capabilities: textAndImage },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    capabilities: ["streaming", "vision", "tools", "reasoning", "image-generation", "audio"],
    authMethods: [{ type: "api" as const, key: "OPENAI_API_KEY", env: "OPENAI_API_KEY" }],
    models: [
      { id: "gpt-5", provider: "openai", label: "GPT-5", contextWindow: 128000, maxOutputTokens: 16384, capabilities: textOnly },
    ],
  },
  {
    id: "google",
    label: "Google",
    capabilities: ["streaming", "vision", "tools"],
    authMethods: [{ type: "api" as const, key: "GOOGLE_GENERATIVE_AI_API_KEY", env: "GOOGLE_GENERATIVE_AI_API_KEY" }],
    models: [
      { id: "gemini-2.5-pro", provider: "google", label: "Gemini 2.5 Pro", contextWindow: 1048576, maxOutputTokens: 65536, capabilities: textAndImage },
    ],
  },
]
