import { Effect } from "effect"
import type { Handler, TuiRenderResult, Embedding, EmbedOptions } from "../handler"
import type { Info as UniversalAttachment } from "../schema"
import type { Provider } from "@/provider/provider"

export const PresentationHandler: Handler = {
  kind: "presentation",

  detect(mime: string): boolean {
    return mime.includes("presentation") || mime.includes("powerpoint") || mime.includes("keynote")
  },

  classify(attachment): Effect.Effect<UniversalAttachment, Error> {
    return Effect.succeed({
      type: "file",
      kind: "presentation",
      mime: attachment.mime,
      filename: attachment.filename,
      url: attachment.url,
      source: attachment.source as any,
      metadata: { _tag: "presentation" },
      display: { badge: "ppt", label: attachment.filename ?? "Presentation" },
      provenance: { source: "tool_output" },
    } as UniversalAttachment)
  },

  describe(attachment: UniversalAttachment): string {
    const name = attachment.filename ?? "presentation"
    const meta = attachment.metadata?._tag === "presentation" ? attachment.metadata : undefined
    const slides = meta?.slides ? ` ${meta.slides} slides` : ""
    return `Presentation: ${name}${slides} (${attachment.mime})`
  },

  render(attachment: UniversalAttachment): TuiRenderResult {
    return {
      badge: { text: "ppt", color: "secondary" },
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
