export * as AttachmentHandler from "./handler"

import { Effect } from "effect"
import type { Kind } from "./kind"
import type { Info as UniversalAttachment } from "./schema"
import type { Provider } from "@/provider/provider"

/**
 * What a provider/model can do with a given attachment.
 */
export type ProviderCapability = "native" | "describe" | "extract" | "unsupported"

/**
 * TUI rendering result for an attachment.
 */
export interface TuiRenderResult {
  badge: { text: string; color: string }
  label: string
  preview?: string       // inline preview (truncated text, ASCII chart, etc.)
  expandable?: boolean   // can be expanded for full view
}

/**
 * An embedding vector with positional metadata.
 */
export interface Embedding {
  type: string           // sub-type: "text_chunk", "image_patch", "audio_window", "sensor_window", etc.
  vector: number[]       // float32 embedding vector
  position: number       // normalized position in document (0.0-1.0)
  length: number         // content length covered (chars, samples, pixels)
}

/**
 * Options passed to handler.embed().
 */
export interface EmbedOptions {
  modelId: string
  dim: number
  endpoint?: string
  headers?: Record<string, string>
  batchSize?: number
  timeoutMs?: number
}

/**
 * Interface that every attachment kind handler must implement.
 *
 * Adding a new attachment kind means:
 * 1. Add the kind to AttachmentKind.Kind
 * 2. Implement this interface
 * 3. Register via AttachmentRegistry.register()
 */
export interface Handler {
  /** The attachment kind this handler manages */
  readonly kind: Kind

  /** Does this handler claim this mime type? */
  detect(mime: string, bytes?: Uint8Array): boolean

  /** Classify a raw attachment — compute kind, metadata, display, provenance */
  classify(attachment: { type: string; mime: string; filename?: string; url: string; source?: unknown }): Effect.Effect<UniversalAttachment, Error>

  /** Generate a text description for models that can't natively handle this kind */
  describe(attachment: UniversalAttachment): string

  /** Optional: normalize/compress/resize before storage */
  normalize?(attachment: UniversalAttachment, config?: unknown): Effect.Effect<UniversalAttachment, Error>

  /** Render for TUI display (badge, preview, chart) */
  render(attachment: UniversalAttachment): TuiRenderResult

  /** What can a given model do with this attachment? */
  capability(model: Provider.Model, attachment: UniversalAttachment): ProviderCapability

  /** Optional: generate embeddings for this attachment kind */
  embed?(attachment: UniversalAttachment, options: EmbedOptions): Effect.Effect<Embedding[], Error>
}
