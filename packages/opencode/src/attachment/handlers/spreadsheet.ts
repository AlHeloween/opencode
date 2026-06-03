import { Effect } from "effect"
import type { Handler, TuiRenderResult, Embedding, EmbedOptions } from "../handler"
import type { Info as UniversalAttachment } from "../schema"
import type { Provider } from "@/provider/provider"

export const SpreadsheetHandler: Handler = {
  kind: "spreadsheet",

  detect(mime: string): boolean {
    return mime.includes("spreadsheet") || mime.includes("excel") || mime.includes("ms-excel") || mime === "text/csv"
  },

  classify(attachment): Effect.Effect<UniversalAttachment, Error> {
    return Effect.succeed({
      type: "file",
      kind: "spreadsheet",
      mime: attachment.mime,
      filename: attachment.filename,
      url: attachment.url,
      source: attachment.source as any,
      metadata: { _tag: "spreadsheet" },
      display: { badge: "xls", label: attachment.filename ?? "Spreadsheet" },
      provenance: { source: "tool_output" },
    } as UniversalAttachment)
  },

  describe(attachment: UniversalAttachment): string {
    const name = attachment.filename ?? "spreadsheet"
    const meta = attachment.metadata?._tag === "spreadsheet" ? attachment.metadata : undefined
    const rows = meta?.rows ? ` ${meta.rows} rows` : ""
    const cols = meta?.columns ? ` × ${meta.columns} cols` : ""
    return `Spreadsheet: ${name}${rows}${cols}`
  },

  render(attachment: UniversalAttachment): TuiRenderResult {
    return {
      badge: { text: "xls", color: "secondary" },
      label: attachment.filename ?? attachment.mime,
    }
  },

  capability(_model: Provider.Model, _attachment: UniversalAttachment): "native" | "describe" | "extract" | "unsupported" {
    return "describe"
  },

  embed(_attachment: UniversalAttachment, _options: EmbedOptions): Effect.Effect<Embedding[], Error> {
    return Effect.succeed([])
  },
}
