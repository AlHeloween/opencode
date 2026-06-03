import { Effect } from "effect"
import type { Handler, TuiRenderResult, Embedding, EmbedOptions } from "../handler"
import type { Info as UniversalAttachment } from "../schema"
import type { Provider } from "@/provider/provider"

export const ImageVectorHandler: Handler = {
  kind: "image_vector",

  detect(mime: string): boolean {
    return mime === "image/svg+xml" || mime.includes("svg")
  },

  classify(attachment): Effect.Effect<UniversalAttachment, Error> {
    return Effect.succeed({
      type: "file",
      kind: "image_vector",
      mime: attachment.mime,
      filename: attachment.filename,
      url: attachment.url,
      source: attachment.source as any,
      metadata: { _tag: "image_vector" },
      display: { badge: "svg", label: attachment.filename ?? "Vector Image" },
      provenance: { source: "tool_output" },
    } as UniversalAttachment)
  },

  describe(attachment: UniversalAttachment): string {
    const name = attachment.filename ?? "vector image"
    return `Vector Image (SVG): ${name}`
  },

  render(attachment: UniversalAttachment): TuiRenderResult {
    return {
      badge: { text: "svg", color: "accent" },
      label: attachment.filename ?? attachment.mime,
    }
  },

  capability(_model: Provider.Model, _attachment: UniversalAttachment): "native" | "describe" | "extract" | "unsupported" {
    return "describe" // SVG is treated as text/code, not rendered as image
  },

  embed(_attachment: UniversalAttachment, _options: EmbedOptions): Effect.Effect<Embedding[], Error> {
    return Effect.succeed([]) // SVG text can be embedded via text handler
  },
}
