export * as ConfigEmbedding from "./embedding"

import { Schema } from "effect"

/**
 * One embedding model entry within a provider group.
 *
 * For local models (endpoint: ""), the handler computes embeddings directly.
 * For API models, the handler calls the specified endpoint.
 */
export const EmbeddingModel = Schema.Struct({
  id: Schema.String,
  endpoint: Schema.String,
  dim: Schema.Number,
  priority: Schema.optional(Schema.Number),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  batch_size: Schema.optional(Schema.Number),
  timeout_ms: Schema.optional(Schema.Number),
  description: Schema.optional(Schema.String),
}).annotate({ identifier: "ConfigEmbeddingModel" })
export type EmbeddingModel = typeof EmbeddingModel.Type

/**
 * Provider group: one attachment kind → N embedding models.
 * Models are ordered by priority (first = preferred).
 */
export const EmbeddingProvider = Schema.Struct({
  type: Schema.String,
  models: Schema.Array(EmbeddingModel),
}).annotate({ identifier: "ConfigEmbeddingProvider" })
export type EmbeddingProvider = typeof EmbeddingProvider.Type

/**
 * Cross-modal fusion settings.
 */
export const CrossModal = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  fusion: Schema.optional(Schema.Literals(["rrf", "weighted_sum"])),
  rrf_k: Schema.optional(Schema.Number),
  default_top_k: Schema.optional(Schema.Number),
  weight_by_priority: Schema.optional(Schema.Boolean),
  min_models_for_cross: Schema.optional(Schema.Number),
}).annotate({ identifier: "ConfigEmbeddingCrossModal" })
export type CrossModal = typeof CrossModal.Type

/**
 * Full embedding configuration.
 */
export const Info = Schema.Struct({
  providers: Schema.Array(EmbeddingProvider),
  cross_modal: Schema.optional(CrossModal),
  auto_embed: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "ConfigEmbedding" })
export type Info = typeof Info.Type
