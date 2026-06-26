import { Context, Effect, Layer, Schema } from "effect"
import { BUILTIN_PROVIDERS } from "./catalog-providers"

export type ProviderID = string & { readonly __brand: "ProviderID" }
export type ModelID = string & { readonly __brand: "ModelID" }

export const ProviderCapability = Schema.Literals([
  "streaming", "vision", "tools", "reasoning", "image-generation", "audio"
])
export type ProviderCapability = typeof ProviderCapability.Type

export const ModelCapability = Schema.Literals([
  "text", "image-input", "image-output", "audio-input", "audio-output", "video-input"
])
export type ModelCapability = typeof ModelCapability.Type

export const AuthMethod = Schema.Union([
  Schema.Struct({ type: Schema.Literal("api"), key: Schema.String, env: Schema.optional(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("oauth"), authorization: Schema.String, token: Schema.String }),
  Schema.Struct({ type: Schema.Literal("wellknown"), url: Schema.String }),
])
export type AuthMethod = typeof AuthMethod.Type

export const PricingConfig = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cachedInput: Schema.optional(Schema.Number),
})
export type PricingConfig = typeof PricingConfig.Type

export const TokenizerConfig = Schema.Struct({
  source: Schema.Literals(["bundled", "huggingface", "tiktoken"]),
  path: Schema.optional(Schema.String),
  repo: Schema.optional(Schema.String),
  type: Schema.Literals(["bpe", "openai", "custom"]),
})
export type TokenizerConfig = typeof TokenizerConfig.Type

export const ModelDef = Schema.Struct({
  id: Schema.String,
  provider: Schema.String,
  label: Schema.String,
  contextWindow: Schema.Number,
  maxOutputTokens: Schema.Number,
  capabilities: Schema.Array(ModelCapability),
  pricing: Schema.optional(PricingConfig),
  tokenizer: Schema.optional(TokenizerConfig),
})
export type ModelDef = typeof ModelDef.Type

export const ProviderDef = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  models: Schema.Array(ModelDef),
  authMethods: Schema.Array(AuthMethod),
  capabilities: Schema.Array(ProviderCapability),
})
export type ProviderDef = typeof ProviderDef.Type

export interface CatalogState {
  providers: Map<string, typeof ProviderDef.Type>
  models: Map<string, typeof ModelDef.Type>
  tokenizers: Map<string, typeof TokenizerConfig.Type>
}

export class ProviderNotFound extends Schema.TaggedError<ProviderNotFound>()("ProviderNotFound", {
  providerID: Schema.String,
}) {}

export class ModelNotFound extends Schema.TaggedError<ModelNotFound>()("ModelNotFound", {
  modelID: Schema.String,
}) {}

export class DuplicateProvider extends Schema.TaggedError<DuplicateProvider>()("DuplicateProvider", {
  providerID: Schema.String,
}) {}

export interface CatalogInterface {
  readonly resolveProvider: (id: string) => Effect.Effect<typeof ProviderDef.Type, ProviderNotFound>
  readonly resolveModel: (id: string) => Effect.Effect<typeof ModelDef.Type, ModelNotFound>
  readonly listProviders: () => Effect.Effect<Array<typeof ProviderDef.Type>>
  readonly listModels: (filter?: { provider?: string }) => Effect.Effect<Array<typeof ModelDef.Type>>
  readonly tokenizerFor: (modelID: string) => Effect.Effect<typeof TokenizerConfig.Type | undefined>
}

export class Catalog extends Context.Service<Catalog, CatalogInterface>()("@opencode/Catalog") {}

const BUILTIN_TOKENIZERS: Record<string, typeof TokenizerConfig.Type> = {
  "deepseek-v4-pro": { source: "bundled", path: "deepseek-v4", type: "bpe" },
  "deepseek-v4-flash": { source: "bundled", path: "deepseek-v4", type: "bpe" },
  "*deepseek-v4*": { source: "bundled", path: "deepseek-v4", type: "bpe" },
  "kat-coder-pro-v2": { source: "bundled", path: "qwen3", type: "bpe" },
  "kwaipilot/kat-coder-pro-v2": { source: "bundled", path: "qwen3", type: "bpe" },
  "*kat-coder*": { source: "bundled", path: "qwen3", type: "bpe" },
  "*qwen3*": { source: "bundled", path: "qwen3", type: "bpe" },
  "*Qwen3*": { source: "bundled", path: "qwen3", type: "bpe" },
  "gpt-5": { source: "tiktoken", path: "o200k_base", type: "openai" },
  "*gpt-5*": { source: "tiktoken", path: "o200k_base", type: "openai" },
  "*gpt-4o*": { source: "tiktoken", path: "o200k_base", type: "openai" },
  "*gpt-4*": { source: "tiktoken", path: "cl100k_base", type: "openai" },
  "*gpt-3.5*": { source: "tiktoken", path: "cl100k_base", type: "openai" },
}

export function resolveTokenizer(modelID: string): typeof TokenizerConfig.Type | undefined {
  if (BUILTIN_TOKENIZERS[modelID]) return BUILTIN_TOKENIZERS[modelID]
  for (const [pattern, config] of Object.entries(BUILTIN_TOKENIZERS)) {
    if (pattern.includes("*")) {
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$", "i")
      if (regex.test(modelID)) return config
    }
  }
  return undefined
}

export const layer = Layer.effect(
  Catalog,
  Effect.sync(() => {
    const state: CatalogState = {
      providers: new Map(),
      models: new Map(),
      tokenizers: new Map(),
    }

    for (const def of BUILTIN_PROVIDERS) {
      state.providers.set(def.id, def)
      for (const model of def.models) state.models.set(model.id, model)
    }

    for (const [pattern, config] of Object.entries(BUILTIN_TOKENIZERS)) {
      state.tokenizers.set(pattern, config)
    }

    return Catalog.of({
      resolveProvider: (id) =>
        Effect.sync(() => {
          const def = state.providers.get(id)
          if (!def) return Effect.fail(new ProviderNotFound({ providerID: id }))
          return def
        }),
      resolveModel: (id) =>
        Effect.sync(() => {
          const def = state.models.get(id)
          if (!def) return Effect.fail(new ModelNotFound({ modelID: id }))
          return def
        }),
      listProviders: () => Effect.sync(() => Array.from(state.providers.values())),
      listModels: (filter) =>
        Effect.sync(() => {
          const all = Array.from(state.models.values())
          return filter?.provider ? all.filter((m) => m.provider === filter.provider) : all
        }),
      tokenizerFor: (modelID) => Effect.sync(() => resolveTokenizer(modelID)),
    })
  }),
)
