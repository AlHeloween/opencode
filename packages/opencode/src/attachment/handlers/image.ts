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
 * Image attachments are normalised with TWO policies (2026-09-24):
 *  - overflow (larger than max_width/max_height): resize to fit, then WebP q80 —
 *    the quality loss is paid only where scaling already changes the pixels;
 *  - fits: LOSSLESS WebP, and only when it actually shrinks the payload; otherwise
 *    the original bytes pass through untouched. A lossy re-encode of an already-fitting
 *    image was pure blur (owner: «ресайз делать только если не влазит — размытое все»,
 *    2026-09-24).
 * `animated: true` keeps GIF/WebP animation instead of collapsing it.
 */
async function toWebp(
  buffer: Buffer,
  maxWidth: number,
  maxHeight: number,
): Promise<{ data: Buffer; width: number; height: number } | null> {
  const image = sharp(buffer, { animated: true })
  const meta = await image.metadata()
  const needsResize = !!(meta.width && meta.height && (meta.width > maxWidth || meta.height > maxHeight))
  if (!needsResize) {
    // Nothing overflows — do NOT buy weight with sharpness. Try a lossless pass and
    // keep it only if it actually shrinks the payload; else keep the original bytes.
    const lossless = await image.webp({ lossless: true, effort: 4 }).toBuffer({ resolveWithObject: true })
    if (lossless.data.length >= buffer.length) return null
    return { data: lossless.data, width: lossless.info.width, height: lossless.info.height }
  }
  // `resolveWithObject` returns the OUTPUT dimensions — what actually goes on
  // the wire AFTER the cap — in the same pass that already encodes the WebP.
  // Asking sharp for them separately would decode the image a second time, and
  // the window budget needs them on every turn (2026-09-18).
  const out = await image
    .resize(maxWidth, maxHeight, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80, effort: 6 })
    .toBuffer({ resolveWithObject: true })
  return { data: out.data, width: out.info.width, height: out.info.height }
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
        // The failure value is `undefined` (not a `Buffer`) so the success type
        // stays `{ data, width, height }`, which the return below reads.
        Effect.catch((error) => {
          log.debug("image normalize failed, keeping original", { error: String(error) })
          return Effect.succeed(undefined)
        }),
      )
      if (!webp) return attachment
      return {
        ...attachment,
        mime: "image/webp",
        url: `data:image/webp;base64,${webp.data.toString("base64")}`,
        // Carry the produced dimensions forward: `normalizeAttachment` lifts
        // them onto the stored part so the window budget can price the image by
        // size instead of by payload bytes — see `MessageV2.FilePart.dimensions`.
        metadata: { _tag: "image", width: webp.width, height: webp.height },
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
