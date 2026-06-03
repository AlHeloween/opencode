import { Effect } from "effect"
import type { Handler, TuiRenderResult, Embedding, EmbedOptions } from "../handler"
import type { Info as UniversalAttachment } from "../schema"
import type { Provider } from "@/provider/provider"
import AdmZip from "adm-zip"
import { extract as tarExtract } from "tar-stream"

function extractZipMeta(buffer: Buffer) {
  const zip = new AdmZip(buffer)
  const entries = zip.getEntries()
  let uncompressedSize = 0
  for (const entry of entries) uncompressedSize += entry.header.size
  return { fileCount: entries.length, compressedSize: buffer.length, uncompressedSize }
}

async function extractTarMeta(buffer: Buffer): Promise<{ fileCount: number; compressedSize: number; uncompressedSize: number }> {
  return new Promise((resolve) => {
    let fileCount = 0; let uncompressedSize = 0
    const extract = tarExtract()
    extract.on("entry", (_header, _stream, next) => { fileCount++; uncompressedSize += _header.size ?? 0; next() })
    extract.on("finish", () => resolve({ fileCount, compressedSize: buffer.length, uncompressedSize }))
    extract.on("error", () => resolve({ fileCount, compressedSize: buffer.length, uncompressedSize }))
    extract.end(buffer)
    setTimeout(() => resolve({ fileCount, compressedSize: buffer.length, uncompressedSize }), 2000)
  })
}

export const ArchiveHandler: Handler = {
  kind: "archive",

  detect(mime: string): boolean {
    return mime.includes("zip") || mime.includes("gzip") || mime.includes("7z") || mime.includes("tar") || mime.includes("rar")
  },

  classify(attachment): Effect.Effect<UniversalAttachment, Error> {
    return Effect.gen(function* () {
      let fileCount = 0; let compressedSize = 0; let uncompressedSize = 0
      if (attachment.url.startsWith("data:")) {
        const commaIdx = attachment.url.indexOf(",")
        if (commaIdx > 0) {
          try {
            const buf = Buffer.from(attachment.url.slice(commaIdx + 1), "base64")
            if (attachment.mime.includes("zip")) {
              const meta = extractZipMeta(buf)
              fileCount = meta.fileCount; compressedSize = meta.compressedSize; uncompressedSize = meta.uncompressedSize
            } else if (attachment.mime.includes("tar") || attachment.mime.includes("gzip")) {
              const meta = yield* Effect.tryPromise(() => extractTarMeta(buf))
              fileCount = meta.fileCount; compressedSize = meta.compressedSize; uncompressedSize = meta.uncompressedSize
            } else {
              compressedSize = buf.length
            }
          } catch { compressedSize = 0 }
        }
      }
      return {
        type: "file", kind: "archive", mime: attachment.mime, filename: attachment.filename,
        url: attachment.url, source: attachment.source as any,
        metadata: { _tag: "archive", fileCount, compressedSize, uncompressedSize },
        display: { badge: attachment.mime.includes("zip") ? "zip" : attachment.mime.includes("tar") ? "tar" : "arc", label: attachment.filename ?? "Archive" },
        provenance: { source: "tool_output" },
      } as UniversalAttachment
    })
  },

  describe(attachment: UniversalAttachment): string {
    const name = attachment.filename ?? "archive"
    const meta = attachment.metadata?._tag === "archive" ? attachment.metadata : undefined
    const files = meta?.fileCount ? ` ${meta.fileCount} files` : ""
    const size = meta?.compressedSize ? ` ${formatBytes(meta.compressedSize)}` : ""
    return `Archive: ${name}${files}${size}`
  },

  render(attachment: UniversalAttachment): TuiRenderResult {
    const meta = attachment.metadata?._tag === "archive" ? attachment.metadata : undefined
    return {
      badge: { text: attachment.mime.includes("zip") ? "zip" : "arc", color: "secondary" },
      label: attachment.filename ?? attachment.mime,
      preview: meta?.fileCount ? `${meta.fileCount} files` : undefined,
    }
  },

  capability(): "unsupported" { return "unsupported" },
  embed(): Effect.Effect<Embedding[], Error> { return Effect.succeed([]) },
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
