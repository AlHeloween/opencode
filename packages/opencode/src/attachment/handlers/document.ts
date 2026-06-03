import { Effect } from "effect"
import type { Handler, TuiRenderResult, Embedding, EmbedOptions } from "../handler"
import type { Info as UniversalAttachment } from "../schema"
import type { Provider } from "@/provider/provider"

export const DocumentHandler: Handler = {
  kind: "document",

  detect(mime: string): boolean {
    return mime === "application/pdf" || mime.includes("vnd.openxmlformats-officedocument")
  },

  classify(attachment): Effect.Effect<UniversalAttachment, Error> {
    return Effect.succeed({
      type: "file",
      kind: "document",
      mime: attachment.mime,
      filename: attachment.filename,
      url: attachment.url,
      source: attachment.source,
      metadata: { _tag: "document" },
      display: { badge: "pdf", label: attachment.filename ?? "Document" },
      provenance: { source: "tool_output" },
    } as UniversalAttachment)
  },

  describe(attachment: UniversalAttachment): string {
    const name = attachment.filename ?? "document"
    return `Document: ${name} (${attachment.mime})`
  },

  render(attachment: UniversalAttachment): TuiRenderResult {
    return {
      badge: { text: attachment.mime === "application/pdf" ? "pdf" : "doc", color: "primary" },
      label: attachment.filename ?? attachment.mime,
    }
  },

  capability(model: Provider.Model, _attachment: UniversalAttachment): "native" | "describe" | "extract" | "unsupported" {
    if (model.capabilities?.input?.pdf) return "native"
    return "describe"
  },

  embed(_attachment: UniversalAttachment, _options: EmbedOptions): Effect.Effect<Embedding[], Error> {
    return Effect.gen(function* () {
      // TODO: Generate text-chunk embeddings from extracted document text
      return []
    })
  },
}
