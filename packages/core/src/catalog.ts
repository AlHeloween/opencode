import { Context, Effect, Layer, Schema } from "effect"

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
  model: Schema.String,
  pattern: Schema.optional(Schema.String),
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
