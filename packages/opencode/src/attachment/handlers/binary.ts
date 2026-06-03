import { Effect } from "effect"
import type { Handler, TuiRenderResult, Embedding, EmbedOptions } from "../handler"
import type { Info as UniversalAttachment } from "../schema"
import type { Provider } from "@/provider/provider"
import { registry } from "../registry"

export const BinaryHandler: Handler = {
  kind: "binary",

  detect(mime: string): boolean {
    return true // Fallback — matches everything unmatched
  },

  classify(attachment): Effect.Effect<UniversalAttachment, Error> {
    return Effect.succeed({
      type: "file",
      kind: "document",
      mime: attachment.mime,
      filename: attachment.filename,
      url: attachment.url,
      source: attachment.source as any,
      metadata: { _tag: "document" },
      display: { badge: "pdf", label: attachment.filename ?? "Document" },
      provenance: { source: "tool_output" },
    } as UniversalAttachment)
  },

  describe(attachment: UniversalAttachment): string {
    const name = attachment.filename ?? "file"
    return `Binary file: ${name} (${attachment.mime})`
  },

  render(attachment: UniversalAttachment): TuiRenderResult {
    const ext = attachment.filename?.split(".").pop()?.toLowerCase() ?? attachment.mime.split("/")[1] ?? "bin"
    return {
      badge: { text: ext.slice(0, 3), color: "secondary" },
      label: attachment.filename ?? attachment.mime,
    }
  },

  capability(_model: Provider.Model, _attachment: UniversalAttachment): "native" | "describe" | "extract" | "unsupported" {
    return "unsupported"
  },
}
