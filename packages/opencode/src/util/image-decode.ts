/**
 * One decode entry point for the TUI's image paths.
 *
 * jimp — the decoder these paths grew up on — has no WebP codec (its formats are
 * png/jpeg/gif/bmp/tiff; its dependency list carries no webp plugin). Every image
 * this app ingests is transcoded to WebP at normalisation (`a42599aa60`,
 * 2026-09-18, «DeepSeek images to WebP»), so every pasted screenshot reached the
 * renderer in a format it could not read: the native path AND the half-block
 * symbols fallback both failed, and the chat showed `[image unavailable]`
 * (owner, 2026-09-20: «почему?»).
 *
 * sharp — already a dependency of the attachment pipeline, so it is present
 * wherever these call sites run — decodes WebP. It is used ONLY as a format
 * bridge: bytes in, PNG bytes out, jimp keeps doing the pixel work, so nothing
 * else about the render moves. Non-WebP bytes stay on the original jimp path,
 * with sharp as a fallback for anything jimp rejects.
 */
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "util.image-decode" })

export function isWebpBytes(bytes: Buffer): boolean {
  return (
    bytes.length > 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"
  )
}

async function sharpPng(bytes: Buffer): Promise<Buffer> {
  const mod = (await import("sharp")) as any
  const sharp = mod.default ?? mod
  return sharp(bytes).png().toBuffer() as Promise<Buffer>
}

/** WebP-aware bytes reader: returns the same jimp image object the call sites use. */
export async function readImage(source: string | Buffer | Uint8Array): Promise<any> {
  const j = (await import("jimp")) as any
  const bytes = typeof source === "string" ? Buffer.from(await Bun.file(source).arrayBuffer()) : Buffer.from(source)
  if (!isWebpBytes(bytes)) {
    try {
      return await j.Jimp.read(bytes)
    } catch (error) {
      log.debug("image decode fell back to sharp", { error: String(error) })
    }
  }
  return await j.Jimp.read(await sharpPng(bytes))
}

/** PNG bytes for the temp-file path (`decodeAndSymbols` writes before decoding). */
export async function toPngBytes(bytes: Buffer): Promise<Buffer> {
  if (!isWebpBytes(bytes)) return bytes
  return sharpPng(bytes)
}
