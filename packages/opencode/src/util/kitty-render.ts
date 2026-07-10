/**
 * Kitty graphics protocol renderer.
 * Emits actual images (not block chars) in terminals that support Kitty protocol.
 * WezTerm, kitty, Ghostty all support this — with full 24-bit color.
 *
 * Protocol: \x1b_Ga=T,f=24,s=W,v=H;<base64_png>\x1b\
 * See: https://sw.kovidgoyal.net/kitty/graphics-protocol/
 */
import { readFileSync } from "fs"
  const j = await import("jimp") as any
  const Jimp = j.Jimp

export async function kittyImage(imagePath: string, maxCols = 80): Promise<string> {
  // Load image — determine if PNG or need conversion
  const isPng = imagePath.toLowerCase().endsWith(".png")
  let pngBuffer: Buffer

  if (isPng) {
    pngBuffer = readFileSync(imagePath)
  } else {
    // Convert JPEG/etc to PNG via jimp
    const img = await Jimp.read(imagePath)
    // Scale to fit terminal width
    const aspect = img.width / img.height
    const cols = Math.min(img.width, maxCols)
    img.resize({ w: cols, h: Math.round(cols / aspect) })
    pngBuffer = Buffer.from(await img.getBuffer("image/png"))
  }

  const base64 = pngBuffer.toString("base64")

  // Get dimensions for the 's' and 'v' keys (needed even for PNG — parse header)
  // For PNG: bytes 16-19 = width (big-endian), 20-23 = height
  const w = pngBuffer.readUInt32BE(16)
  const h = pngBuffer.readUInt32BE(20)

  // Kitty transmit-and-display: a=T, format=png: f=24, size: s=W,v=H
  // Use chunked transmission for large images
  const CHUNK = 4096

  if (base64.length <= CHUNK) {
    return `\x1b_Ga=T,f=24,s=${w},v=${h};${base64}\x1b\\`
  }

  // Chunked: first chunk has m=1 (more follows)
  let result = ""
  for (let i = 0; i < base64.length; i += CHUNK) {
    const chunk = base64.slice(i, i + CHUNK)
    const more = i + CHUNK < base64.length ? 1 : 0
    if (i === 0) {
      result += `\x1b_Ga=T,f=24,s=${w},v=${h},m=${more};${chunk}\x1b\\`
    } else {
      result += `\x1b_Gm=${more};${chunk}\x1b\\`
    }
  }
  return result
}
