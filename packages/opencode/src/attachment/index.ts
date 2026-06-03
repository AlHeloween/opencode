// Side-effect import: registers all built-in handlers on module load
import "./handlers/index"

export { Kind, fromMime } from "./kind"
export * as AttachmentKind from "./kind"

export { Metadata, Display, Provenance, Info } from "./schema"
export * as AttachmentSchema from "./schema"
export type { Info as UniversalAttachment } from "./schema"

export type { Handler, ProviderCapability, TuiRenderResult, Embedding, EmbedOptions } from "./handler"
export * as AttachmentHandler from "./handler"

export { registry, Service } from "./registry"
export * as AttachmentRegistry from "./registry"

export { getCapability } from "./capability"
export * as AttachmentCapability from "./capability"

export { embedAttachment, querySimilar } from "./embedding"
export type { FusedResult, EmbeddingQuery } from "./embedding"
export * as AttachmentEmbedding from "./embedding"
