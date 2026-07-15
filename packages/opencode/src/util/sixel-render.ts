/**
 * Sixel graphics protocol renderer.
 * Emits real pixel images (not block chars) in terminals that support Sixel.
 * Windows Terminal (2024+), foot, Konsole, xterm with Sixel patch all support this.
 *
 * Pipeline (file):  PNG file → Jimp decode → color quantization → Sixel escape sequence
 * Pipeline (pixels): RGBA pixels → color quantization → Sixel escape sequence
 * 
 * Sixel format:
 *   \x1bPq            — DCS (Device Control String) start
 *   #N;2;R;G;B        — Define palette register N as RGB(0-100)
 *   #N                — Select palette register
 *   <sixel chars>     — 6 vertical pixels encoded per char (ASCII 63-126)
 *   $                 — Carriage return (back to column 0, same band)
 *   -                 — Sixel newline (advance to next row band)
 *   \x1b\             — ST (String Terminator)
 *
 * For full color: for each 6-row band, emit one pass per color used.
 * Each pass selects the color and which 6 pixels in that column have it.
 * See: https://en.wikipedia.org/wiki/Sixel
 */
import { readFileSync } from "fs"

export interface SixelOptions {
  maxCols?: number     // Max terminal columns (default: 80)
  maxRows?: number     // Max rows (auto if not set)
  quantize?: number    // Color palette size (default: 256)
}

type Rgb = [number, number, number]

/**
 * Quantize image pixels to a fixed palette using uniform 5-6-5 quantization.
 * Returns palette (array of RGB) and per-pixel palette indices.
 */
function quantize565(
  pixels: Rgb[],
): { palette: Rgb[]; indices: Uint16Array } {
  const total = pixels.length
  const indices = new Uint16Array(total)
  const paletteMap = new Map<number, number>()
  const paletteList: Rgb[] = []

  for (let i = 0; i < total; i++) {
    const [r, g, b] = pixels[i]!
    // 5-6-5 quantization: RRRRRGGG GGGBBBBB → 16-bit key
    const key = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
    let idx = paletteMap.get(key)
    if (idx === undefined) {
      idx = paletteList.length
      paletteMap.set(key, idx)
      // Dequantize to nearest representable color
      paletteList.push([
        (r >> 3) * 255 / 31,
        (g >> 2) * 255 / 63,
        (b >> 3) * 255 / 31,
      ].map(Math.round) as Rgb)
    }
    indices[i] = idx!
  }

  return { palette: paletteList, indices }
}

/**
 * Generate Sixel escape sequence from a PNG image file.
 * Returns the raw escape sequence string to write to terminal.
 * Each band of 6 rows is rendered in multiple passes — one per color.
 */
export async function sixelImage(
  imagePath: string,
  options: SixelOptions = {},
): Promise<string> {
  const maxCols = options.maxCols ?? 80

  // Load image with Jimp
  const j = await import("jimp") as any
  const Jimp = j.Jimp
  const img = await Jimp.read(imagePath)

  // Calculate dimensions
  const aspect = img.width / img.height
  const cols = Math.min(img.width, maxCols)
  const rows = options.maxRows
    ? Math.min(Math.round(cols / aspect), options.maxRows)
    : Math.round(cols / aspect)
  // Round rows up to nearest multiple of 6 (sixel band size)
  const sixelRows = Math.ceil(rows / 6) * 6

  img.resize({ w: cols, h: sixelRows })

  // Extract all pixels as RGB tuples
  const pixels: Rgb[] = []
  for (let y = 0; y < sixelRows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = (y * cols + x) * 4
      pixels.push([
        img.bitmap.data[idx]!,
        img.bitmap.data[idx + 1]!,
        img.bitmap.data[idx + 2]!,
      ])
    }
  }

  // Quantize to 5-6-5 palette
  const { palette, indices } = quantize565(pixels)
  const parts: string[] = []

  // DCS start
  parts.push("\x1bPq")

  // Define palette: #N;2;R;G;B (R/G/B 0-100)
  // Limit to 256 colors per Sixel spec maximum (though most terminals handle more)
  const maxPalette = Math.min(palette.length, 65536)
  for (let i = 0; i < maxPalette; i++) {
    const [r, g, b] = palette[i]!
    const sr = Math.round(r / 2.55)
    const sg = Math.round(g / 2.55)
    const sb = Math.round(b / 2.55)
    parts.push(`#${i};2;${sr};${sg};${sb}`)
  }

  // Encode each 6-row band
  const bands = sixelRows / 6

  for (let band = 0; band < bands; band++) {
    const baseY = band * 6

    // Collect which colors are used in this band, for each column
    // Map: colorIdx → bitmask[] (one per column)
    const colorBands = new Map<number, Uint8Array>()

    for (let x = 0; x < cols; x++) {
      for (let bit = 0; bit < 6; bit++) {
        const y = baseY + bit
        if (y >= sixelRows) continue
        const pixelIdx = y * cols + x
        const colorIdx = indices[pixelIdx]!
        if (colorIdx >= maxPalette) continue

        let bitmask = colorBands.get(colorIdx)
        if (!bitmask) {
          bitmask = new Uint8Array(cols)
          colorBands.set(colorIdx, bitmask)
        }
        bitmask[x] = (bitmask[x] ?? 0) | (1 << bit)
      }
    }

    // Emit one pass per color in this band
    // Sort colors by frequency for efficiency (most common first)
    const sortedColors = [...colorBands.entries()].sort(
      (a, b) => {
        const countA = a[1].reduce((s, v) => s + (v ? 1 : 0), 0)
        const countB = b[1].reduce((s, v) => s + (v ? 1 : 0), 0)
        return countB - countA  // most used first
      },
    )

    for (const [colorIdx, bitmask] of sortedColors) {
      // Select color
      parts.push(`#${colorIdx}`)

      // Output sixel characters for this color layer
      for (let x = 0; x < cols; x++) {
        const code = bitmask[x] ?? 0
        parts.push(String.fromCharCode(0x3f + code))
      }

      // Within-band newline (stays at same 6-row band, advances vertical position)
      // $ = carriage return to column 0 at same vertical band position
      parts.push("$")
    }

    // Move to next 6-row band
    parts.push("-")
  }

  // ST (String Terminator)
  parts.push("\x1b\\")

  return parts.join("")
}

/**
 * Generate Sixel escape sequence directly from raw RGBA pixel data.
 * Uses the same 5-6-5 quantization and band encoding as sixelImage(),
 * but takes pre-decoded pixels instead of reading a file.
 *
 * @param pixels  Flat array of pixels in RGBA order: [R,G,B,A, R,G,B,A, ...]
 * @param width   Image width in pixels
 * @param height  Image height in pixels (rounded up to multiple of 6 internally)
 */
export function pixelsToSixel(
  pixels: Uint8Array,
  width: number,
  height: number,
): string {
  // Round height up to nearest multiple of 6
  const sixelRows = Math.ceil(height / 6) * 6
  const cols = width

  // Extract RGB from RGBA pixels into flat array
  const rgbPixels: Rgb[] = []
  for (let y = 0; y < sixelRows; y++) {
    for (let x = 0; x < cols; x++) {
      if (y < height) {
        const idx = (y * cols + x) * 4
        rgbPixels.push([pixels[idx]!, pixels[idx + 1]!, pixels[idx + 2]!])
      } else {
        // Pad rows: black (won't use these since they're past original height)
        rgbPixels.push([0, 0, 0])
      }
    }
  }

  // Quantize and encode
  const { palette, indices } = quantize565(rgbPixels)
  const parts: string[] = []

  parts.push("\x1bPq")

  // Define palette
  const maxPalette = Math.min(palette.length, 65536)
  for (let i = 0; i < maxPalette; i++) {
    const [r, g, b] = palette[i]!
    parts.push(`#${i};2;${Math.round(r / 2.55)};${Math.round(g / 2.55)};${Math.round(b / 2.55)}`)
  }

  // Encode bands
  const bands = sixelRows / 6
  for (let band = 0; band < bands; band++) {
    const baseY = band * 6
    const colorBands = new Map<number, Uint8Array>()

    for (let x = 0; x < cols; x++) {
      for (let bit = 0; bit < 6; bit++) {
        const y = baseY + bit
        if (y >= height) continue  // skip padded rows
        const pixelIdx = y * cols + x
        const colorIdx = indices[pixelIdx]!
        if (colorIdx >= maxPalette) continue

        let bitmask = colorBands.get(colorIdx)
        if (!bitmask) {
          bitmask = new Uint8Array(cols)
          colorBands.set(colorIdx, bitmask)
        }
        bitmask[x] = (bitmask[x] ?? 0) | (1 << bit)
      }
    }

    const sortedColors = [...colorBands.entries()].sort((a, b) => {
      const countA = a[1].reduce((s, v) => s + (v ? 1 : 0), 0)
      const countB = b[1].reduce((s, v) => s + (v ? 1 : 0), 0)
      return countB - countA
    })

    for (const [colorIdx, bitmask] of sortedColors) {
      parts.push(`#${colorIdx}`)
      for (let x = 0; x < cols; x++) {
        parts.push(String.fromCharCode(0x3f + (bitmask[x] ?? 0)))
      }
      parts.push("$")
    }
    parts.push("-")
  }

  parts.push("\x1b\\")
  return parts.join("")
}
