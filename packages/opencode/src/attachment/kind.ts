export * as AttachmentKind from "./kind"

import { Schema } from "effect"

/**
 * Tagged union of all supported attachment kinds.
 *
 * Each kind has a registered handler in the AttachmentRegistry that provides
 * detection, classification, description, normalization, rendering, and
 * provider capability checks.
 *
 * Adding a new kind requires:
 * 1. Adding the literal here
 * 2. Registering a handler via AttachmentRegistry.register()
 * 3. Optionally adding embedding config via ConfigEmbedding
 */
export const Kind = Schema.Literals([
  "image",          // image/png, image/jpeg, image/gif, image/webp
  "image_vector",   // image/svg+xml
  "audio",          // audio/wav, audio/mp3, audio/ogg, audio/flac
  "video",          // video/mp4, video/webm, video/avi
  "document",       // application/pdf
  "spreadsheet",    // application/vnd.ms-excel, text/csv
  "presentation",   // application/vnd.ms-powerpoint
  "spatial",        // model/gltf+json, 3D meshes, point clouds
  "sensor",         // application/x-hdf5, application/x-sensor+json
  "archive",        // application/zip, application/gzip
  "data",           // application/json, application/x-parquet
  "text",           // text/plain, text/markdown
  "code",           // text/x-python, text/typescript, etc.
  "binary",         // application/octet-stream, unknown
]).annotate({ identifier: "AttachmentKind" })

export type Kind = typeof Kind.Type

/**
 * Detect the attachment kind from a mime type string.
 * Falls back to "binary" for unmatched types.
 */
export function fromMime(mime: string): Kind {
  if (mime.startsWith("image/svg")) return "image_vector"
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return "video"
  if (mime === "application/pdf") return "document"
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv") return "spreadsheet"
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "presentation"
  if (mime.includes("gltf") || mime.includes("glb") || mime.includes("model/")) return "spatial"
  if (mime.includes("hdf5") || mime.includes("hdf") || mime.includes("sensor")) return "sensor"
  if (mime.includes("zip") || mime.includes("gzip") || mime.includes("7z") || mime.includes("tar")) return "archive"
  if (mime === "application/json" || mime.includes("parquet") || mime.includes("avro")) return "data"
  if (mime.startsWith("text/")) {
    if (mime.includes("python") || mime.includes("javascript") || mime.includes("typescript") ||
        mime.includes("java") || mime.includes("c++") || mime.includes("rust") ||
        mime.includes("css") || mime.includes("html") || mime.includes("sql") ||
        mime.includes("shell") || mime.includes("yaml") || mime.includes("xml")) return "code"
    return "text"
  }
  if (mime === "application/octet-stream") return "binary"
  return "binary"
}
