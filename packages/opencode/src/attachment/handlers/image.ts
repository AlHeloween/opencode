import { Effect } from "effect"
import type { Handler, TuiRenderResult, Embedding, EmbedOptions } from "../handler"
import type { Info as UniversalAttachment } from "../schema"
import type { Provider } from "@/provider/provider"
import sharp from "sharp"

async function extractImageMeta(buffer: Buffer): Promise<{
  width: number; height: number; format?: string
}> {
  try {
    const meta = await sharp(buffer).metadata()
    return { width: meta.width ?? 0, height: meta.height ?? 0, format: meta.format }
  } catch {
    return { width: 0, height: 0 }
  }
}

async function resizeImage(buffer: Buffer, maxWidth: number, maxHeight: number): Promise<Buffer> {
  try {
    const image = sharp(buffer)
    const meta = await image.metadata()
    if (!meta.width || !meta.height) return buffer
    if (meta.width <= maxWidth && meta.height <= maxHeight) return buffer
    return await image.resize(maxWidth, maxHeight, { fit: "inside", withoutEnlargement: true }).toBuffer()
  } catch {
    return buffer
  }
}

export const ImageHandler: Handler = {
  kind: "image",

  detect(mime: string): boolean {
    return mime.startsWith("image/") && !mime.includes("svg") && !mime.includes("vnd.fastbidsheet")
  },

  classify(attachment): Effect.Effect<UniversalAttachment, Error> {
    return Effect.gen(function* () {
      let width = 0; let height = 0
      if (attachment.url.startsWith("data:")) {
        const commaIdx = attachment.url.indexOf(",")
        if (commaIdx > 0) {
          try {
            const buf = Buffer.from(attachment.url.slice(commaIdx + 1), "base64")
            const meta = yield* Effect.tryPromise(() => extractImageMeta(buf))
            width = meta.width; height = meta.height
          } catch { /* use defaults */ }
        }
      }
      return {
        type: "file",
        kind: "image",
        mime: attachment.mime,
        filename: attachment.filename,
        url: attachment.url,
        source: attachment.source as any,
        metadata: { _tag: "image", width, height },
        display: { badge: "img", label: attachment.filename ?? "Image" },
        provenance: { source: attachment.source ? "tool_output" : "user_upload" },
      } as UniversalAttachment
    })
  },

  describe(attachment: UniversalAttachment): string {
    const name = attachment.filename ?? "image"
    const meta = attachment.metadata?._tag === "image" ? attachment.metadata : undefined
    const dims = meta?.width && meta?.height ? ` ${meta.width}×${meta.height}` : ""
    return `Image: ${name}${dims} (${attachment.mime})`
  },

  normalize(attachment: UniversalAttachment, config?: any): Effect.Effect<UniversalAttachment, Error> {
    return Effect.gen(function* () {
      if (!attachment.url.startsWith("data:")) return attachment
      const maxWidth = config?.image?.max_width ?? 2000
      const maxHeight = config?.image?.max_height ?? 2000

      const commaIdx = attachment.url.indexOf(",")
      if (commaIdx <= 0) return attachment

      try {
        const mimePrefix = attachment.url.slice(5, commaIdx).split(";")[0]
        const buf = Buffer.from(attachment.url.slice(commaIdx + 1), "base64")
        const resized = yield* Effect.tryPromise(() => resizeImage(buf, maxWidth, maxHeight))
        const newUrl = `data:${mimePrefix};base64,${resized.toString("base64")}`
        return { ...attachment, url: newUrl }
      } catch {
        return attachment
      }
    })
  },

  render(attachment: UniversalAttachment): TuiRenderResult {
    const meta = attachment.metadata?._tag === "image" ? attachment.metadata : undefined
    const preview = meta?.width && meta?.height ? `${meta.width}×${meta.height}` : undefined
    return {
      badge: { text: "img", color: "accent" },
      label: attachment.filename ?? attachment.mime,
      preview,
    }
  },

  capability(model: Provider.Model, _attachment: UniversalAttachment): "native" | "describe" | "extract" | "unsupported" {
    if (model.capabilities?.input?.image) return "native"
    return "describe"
  },

  embed(_attachment: UniversalAttachment, _options: EmbedOptions): Effect.Effect<Embedding[], Error> {
    return Effect.succeed([])
  },
}
