import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import type { Handler, TuiRenderResult, Embedding, EmbedOptions } from "../handler"
import type { Info as UniversalAttachment } from "../schema"
import type { Provider } from "@/provider/provider"
import sharp from "sharp"

const log = Log.create({ service: "attachment.image" })

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

/**
 * Every image attachment is normalised to WebP — quality 80 at compression
 * effort 6 (the maximum) after the resize (2026-09-18, Alexander). The
 * provider SDKs that accept images take `image/webp` natively (DeepSeek's
 * `image_url` part lists gif/jpeg/png/webp), and the text-only fallback reads
 * the same bytes through sharp — a smaller payload is a smaller wire.
 * `animated: true` keeps GIF/WebP animation instead of collapsing it.
 */
async function toWebp(buffer: Buffer, maxWidth: number, maxHeight: number): Promise<Buffer> {
  const image = sharp(buffer, { animated: true })
  const meta = await image.metadata()
  const resized =
    meta.width && meta.height && (meta.width > maxWidth || meta.height > maxHeight)
      ? image.resize(maxWidth, maxHeight, { fit: "inside", withoutEnlargement: true })
      : image
  return resized.webp({ quality: 80, effort: 6 }).toBuffer()
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
          } catch (e) { log.debug("image metadata extraction failed", { error: String(e) }) }
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

      const buf = Buffer.from(attachment.url.slice(commaIdx + 1), "base64")
      const webp = yield* Effect.tryPromise(() => toWebp(buf, maxWidth, maxHeight)).pipe(
        // Undecodable or exotic input: keep the original bytes rather than
        // losing the attachment. sharp cannot read every format — expected.
        Effect.catch((error) => {
          log.debug("image normalize failed, keeping original", { error: String(error) })
          return Effect.succeed(undefined as Buffer | undefined)
        }),
      )
      if (!webp) return attachment
      return { ...attachment, mime: "image/webp", url: `data:image/webp;base64,${webp.toString("base64")}` }
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
