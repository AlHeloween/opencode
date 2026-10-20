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
 * Image attachments are normalised with ONE policy (t103, 2026-10-20):
 * every image becomes WebP before any provider sees it, whatever its source.
 *  - overflow (larger than max_width/max_height): resize to fit, then WebP q80 —
 *    the quality loss is paid only where scaling already changes the pixels
 *    (owner 2026-09-24: «ресайз делать только если не влазит — размытое все»);
 *  - fits: LOSSLESS WebP, unconditionally — pixels bit-identical, so the
 *    2026-09-24 no-blur ruling holds and no provider allowlist is ever met
 *    with a foreign format (owner 2026-10-20: bmp error 2013 from MiniMax).
 * `animated: true` keeps GIF/WebP animation instead of collapsing it.
 *
 * sharp cannot decode every format it can be handed — BMP is the measured one
 * (`Input buffer contains unsupported image format`, t103 probe 2026-10-20;
 * sharp input docs list jpeg/png/webp/gif/svg/heif/tiff, no BMP). Those bytes
 * take the jimp bridge (jimp reads BMP) back into PNG and rejoin the sharp
 * pipeline. Anything NEITHER decoder reads is REFUSED with
 * `[unsupported-image-format]` — named, never forwarded raw: forwarding raw
 * is exactly the 2013 crash this file exists to prevent.
 */
function magicOf(buffer: Buffer): string {
  return Array.from(buffer.subarray(0, 4))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ")
}

/** jimp bridge for formats sharp cannot decode (BMP): read with jimp, PNG out. */
async function jimpPngBridge(buffer: Buffer): Promise<Buffer | null> {
  try {
    const mod = (await import("jimp")) as any
    const Jimp = mod.Jimp ?? mod.default?.Jimp ?? mod.default
    if (!Jimp?.read) return null
    const img = await Jimp.read(buffer)
    const png = (await img.getBuffer("image/png")) as Buffer
    return Buffer.from(png)
  } catch {
    return null
  }
}

async function canSharpRead(buffer: Buffer): Promise<boolean> {
  try {
    await sharp(buffer).metadata()
    return true
  } catch {
    return false
  }
}

function refuse(mime: string, buffer: Buffer, via: string): Error {
  return new Error(
    `[unsupported-image-format] cannot decode ${mime} (${buffer.length} bytes, magic=${magicOf(buffer)}) via ${via}: ` +
      `neither sharp nor jimp could read it — refusing to forward raw bytes to the provider`,
  )
}

async function toWebp(
  buffer: Buffer,
  maxWidth: number,
  maxHeight: number,
  mime: string,
): Promise<{ data: Buffer; width: number; height: number }> {
  let input = buffer
  if (!(await canSharpRead(buffer))) {
    const bridged = await jimpPngBridge(buffer)
    if (!bridged) throw refuse(mime, buffer, "sharp+jimp")
    input = bridged
  }
  const image = sharp(input, { animated: true })
  let meta: { width?: number; height?: number }
  try {
    meta = await image.metadata()
  } catch (error) {
    throw refuse(mime, buffer, `sharp-metadata(${String(error).slice(0, 120)})`)
  }
  const needsResize = !!(meta.width && meta.height && (meta.width > maxWidth || meta.height > maxHeight))
  if (!needsResize) {
    // ALWAYS WebP, even when lossless is larger than the source (t103): a
    // photo jpg can triple in bytes, but a foreign format on the wire is a
    // provider 400 — and the Files-API reference (plan T3) removes the bytes
    // from the request once it lands. Pixels stay bit-identical (lossless).
    const lossless = await image.webp({ lossless: true, effort: 4 }).toBuffer({ resolveWithObject: true })
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
      // t103: decode failure is a REFUSAL with `[unsupported-image-format]`,
      // never keep-original — keep-original forwarded a BMP raw and the
      // provider answered 400/2013. The failure channel is in-contract
      // (`Handler.normalize` returns `Effect<_, Error>`).
      const webp = yield* Effect.tryPromise({
        try: () => toWebp(buf, maxWidth, maxHeight, attachment.mime),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      })
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
