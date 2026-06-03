import { Effect } from "effect"
import type { Handler, TuiRenderResult, Embedding, EmbedOptions } from "../handler"
import type { Info as UniversalAttachment } from "../schema"
import type { Provider } from "@/provider/provider"

function detectJSONSchema(text: string): { rowCount: number; columnCount: number } {
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return { rowCount: 0, columnCount: 0 }
      const cols = typeof parsed[0] === "object" && parsed[0] !== null ? Object.keys(parsed[0] as object).length : 1
      return { rowCount: parsed.length, columnCount: cols }
    }
    if (typeof parsed === "object" && parsed !== null) {
      const keys = Object.keys(parsed)
      return { rowCount: 1, columnCount: keys.length }
    }
    return { rowCount: 0, columnCount: 0 }
  } catch {
    return { rowCount: 0, columnCount: 0 }
  }
}

function detectCSVSchema(text: string): { rowCount: number; columnCount: number } {
  const lines = text.split("\n").filter((l) => l.trim())
  if (lines.length === 0) return { rowCount: 0, columnCount: 0 }
  const columns = lines[0].split(",").length
  return { rowCount: lines.length, columnCount: columns }
}

export const DataHandler: Handler = {
  kind: "data",

  detect(mime: string): boolean {
    return mime === "application/json" || mime.includes("parquet") || mime.includes("avro")
  },

  classify(attachment): Effect.Effect<UniversalAttachment, Error> {
    return Effect.gen(function* () {
      let rowCount = 0; let columnCount = 0
      if (attachment.url.startsWith("data:")) {
        const commaIdx = attachment.url.indexOf(",")
        if (commaIdx > 0) {
          try {
            const text = Buffer.from(attachment.url.slice(commaIdx + 1), "base64").toString("utf-8")
            if (attachment.mime === "application/json") {
              const schema = detectJSONSchema(text)
              rowCount = schema.rowCount; columnCount = schema.columnCount
            } else if (attachment.mime === "text/csv") {
              const schema = detectCSVSchema(text)
              rowCount = schema.rowCount; columnCount = schema.columnCount
            }
          } catch { /* binary format, skip */ }
        }
      }
      return {
        type: "file", kind: "data", mime: attachment.mime, filename: attachment.filename,
        url: attachment.url, source: attachment.source as any,
        metadata: { _tag: "data", rowCount, columnCount },
        display: { badge: attachment.mime === "application/json" ? "json" : "dat", label: attachment.filename ?? "Data" },
        provenance: { source: "tool_output" },
      } as UniversalAttachment
    })
  },

  describe(attachment: UniversalAttachment): string {
    const name = attachment.filename ?? "data"
    const meta = attachment.metadata?._tag === "data" ? attachment.metadata : undefined
    const rows = meta?.rowCount ? ` ${meta.rowCount} rows` : ""
    const cols = meta?.columnCount && meta?.columnCount > 1 ? ` × ${meta.columnCount} cols` : ""
    return `Data: ${name}${rows}${cols} (${attachment.mime})`
  },

  render(attachment: UniversalAttachment): TuiRenderResult {
    return {
      badge: { text: attachment.mime === "application/json" ? "json" : "dat", color: "secondary" },
      label: attachment.filename ?? attachment.mime,
    }
  },

  capability(): "describe" { return "describe" },
  embed(): Effect.Effect<Embedding[], Error> { return Effect.succeed([]) },
}
