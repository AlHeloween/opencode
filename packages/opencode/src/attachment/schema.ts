export * as AttachmentSchema from "./schema"

import { Schema } from "effect"
import type { Types } from "effect"
import { Kind } from "./kind"

/**
 * Kind-specific metadata — discriminated by `_tag` which matches the parent kind.
 * All fields are optional to maintain backward compatibility with existing DB rows.
 */
export const Metadata = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("image"), width: Schema.Number, height: Schema.Number, colorSpace: Schema.optional(Schema.String) }),
  Schema.Struct({ _tag: Schema.Literal("image_vector"), width: Schema.optional(Schema.Number), height: Schema.optional(Schema.Number) }),
  Schema.Struct({ _tag: Schema.Literal("audio"), duration: Schema.Number, sampleRate: Schema.Number, channels: Schema.Number, codec: Schema.optional(Schema.String) }),
  Schema.Struct({ _tag: Schema.Literal("video"), duration: Schema.Number, width: Schema.Number, height: Schema.Number, fps: Schema.Number, codec: Schema.optional(Schema.String) }),
  Schema.Struct({ _tag: Schema.Literal("document"), pages: Schema.optional(Schema.Number), author: Schema.optional(Schema.String), title: Schema.optional(Schema.String) }),
  Schema.Struct({ _tag: Schema.Literal("spreadsheet"), rows: Schema.optional(Schema.Number), columns: Schema.optional(Schema.Number) }),
  Schema.Struct({ _tag: Schema.Literal("presentation"), slides: Schema.optional(Schema.Number) }),
  Schema.Struct({ _tag: Schema.Literal("spatial"), format: Schema.String, vertexCount: Schema.optional(Schema.Number), boundsMinX: Schema.optional(Schema.Number), boundsMinY: Schema.optional(Schema.Number), boundsMinZ: Schema.optional(Schema.Number), boundsMaxX: Schema.optional(Schema.Number), boundsMaxY: Schema.optional(Schema.Number), boundsMaxZ: Schema.optional(Schema.Number) }),
  Schema.Struct({ _tag: Schema.Literal("sensor"), channels: Schema.Array(Schema.String), sampleRate: Schema.Number, duration: Schema.Number, units: Schema.String, range: Schema.optional(Schema.Struct({ min: Schema.Number, max: Schema.Number })), format: Schema.Literals(["hdf5", "json", "csv"]) }),
  Schema.Struct({ _tag: Schema.Literal("archive"), fileCount: Schema.Number, compressedSize: Schema.Number, uncompressedSize: Schema.Number }),
  Schema.Struct({ _tag: Schema.Literal("data"), schema_: Schema.optional(Schema.Unknown), rowCount: Schema.optional(Schema.Number), columnCount: Schema.optional(Schema.Number) }),
  Schema.Struct({ _tag: Schema.Literal("text"), lines: Schema.Number, chars: Schema.Number }),
  Schema.Struct({ _tag: Schema.Literal("code"), language: Schema.String, lines: Schema.Number, chars: Schema.Number }),
  Schema.Struct({ _tag: Schema.Literal("binary"), size: Schema.Number }),
]).annotate({ identifier: "AttachmentMetadata" })

export type Metadata = typeof Metadata.Type

/**
 * Display information for TUI rendering.
 */
export const Display = Schema.Struct({
  badge: Schema.String,    // short label: "img", "wav", "h5", "pdf"
  label: Schema.String,    // human-readable: "Magnetometer HDF5"
}).annotate({ identifier: "AttachmentDisplay" })
export type Display = typeof Display.Type

/**
 * Provenance tracking for attachments.
 */
export const Provenance = Schema.Struct({
  source: Schema.Literals(["user_upload", "tool_output", "model_generated"]),
  toolName: Schema.optional(Schema.String),
  transformHistory: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "AttachmentProvenance" })
export type Provenance = typeof Provenance.Type

/**
 * Universal attachment — the canonical representation for all file attachments.
 *
 * Extends the existing FilePart shape (type: "file", mime, filename, url, source)
 * with kind-based classification, metadata, display info, and provenance tracking.
 *
 * All new fields are optional for backward compatibility with existing DB rows.
 * The registry.classify() method backfills missing fields on first read.
 */
export const Info = Schema.Struct({
  type: Schema.Literal("file"),
  kind: Kind,
  mime: Schema.String,
  filename: Schema.optional(Schema.String),
  url: Schema.String,
  source: Schema.optional(Schema.Unknown),
  metadata: Schema.optional(Metadata),
  display: Schema.optional(Display),
  provenance: Schema.optional(Provenance),
}).annotate({ identifier: "UniversalAttachment" })

export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>
