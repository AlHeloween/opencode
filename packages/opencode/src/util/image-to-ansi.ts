/**
 * Pure ANSI TrueColor image renderer — no WebGPU, no Three.js.
 * Uses Jimp for image decoding + half-block characters for 2x vertical resolution.
 * Works in ANY terminal with TrueColor support (WezTerm, Windows Terminal, kitty, etc.)
 *
 * Algorithm: for each pair of rows (top, bottom), emit ▀ with
 *   fg=bottom_color, bg=top_color → one char = two pixels vertically.
 *
 * Two output modes:
 *   - imageToAnsi()     → raw ANSI escape string (direct terminal write)
 *   - imageToChunks()   → structured rows of {fg, bg, text} for TUI inline rendering
 */
import { RGBA } from "@opentui/core"

export interface AnsiImageOptions {
  width: number       // target width in columns
  height?: number     // target height in rows (auto-calculated from aspect ratio)
}

/** A single half-block cell for TUI inline rendering. */
export interface AnsiChunk {
  fg: RGBA
  bg: RGBA
  text: string
}

async function decodeImage(imagePath: string, cols: number, rows: number): Promise<any> {
  const j = await import("jimp") as any
  const Jimp = j.Jimp
  const img = await Jimp.read(imagePath)
  img.resize({ w: cols, h: rows * 2 })
  return img
}

/** Render image to inline TUI chunks — no escape sequences, no terminal write. */
export async function imageToChunks(
  imagePath: string,
  options: AnsiImageOptions,
): Promise<AnsiChunk[][]> {
  const j = await import("jimp") as any
  const Jimp = j.Jimp
  const img = await Jimp.read(imagePath)

  const aspect = img.width / img.height
  const cols = options.width
  const rows = options.height ?? Math.round(cols / aspect / 2)

  img.resize({ w: cols, h: rows * 2 })

  const result: AnsiChunk[][] = []
  for (let y = 0; y < rows; y++) {
    const line: AnsiChunk[] = []
    for (let x = 0; x < cols; x++) {
      const topIdx = (y * 2 * cols + x) * 4
      const botIdx = ((y * 2 + 1) * cols + x) * 4

      const tr = img.bitmap.data[topIdx]!
      const tg = img.bitmap.data[topIdx + 1]!
      const tb = img.bitmap.data[topIdx + 2]!
      const br = img.bitmap.data[botIdx]!
      const bg = img.bitmap.data[botIdx + 1]!
      const bb = img.bitmap.data[botIdx + 2]!

      line.push({
        fg: RGBA.fromInts(br, bg, bb),       // bottom pixel = foreground
        bg: RGBA.fromInts(tr, tg, tb),       // top pixel = background
        text: "▀",
      })
    }
    result.push(line)
  }
  return result
}

export async function imageToAnsi(
  imagePath: string,
  options: AnsiImageOptions,
): Promise<string> {
  const j = await import("jimp") as any
  const Jimp = j.Jimp
  const img = await Jimp.read(imagePath)

  const aspect = img.width / img.height
  const cols = options.width
  const rows = options.height ?? Math.round(cols / aspect / 2)

  img.resize({ w: cols, h: rows * 2 })

  const lines: string[] = []
  for (let y = 0; y < rows; y++) {
    let line = ""
    for (let x = 0; x < cols; x++) {
      const topIdx = (y * 2 * cols + x) * 4
      const botIdx = ((y * 2 + 1) * cols + x) * 4

      const tr = img.bitmap.data[topIdx]!
      const tg = img.bitmap.data[topIdx + 1]!
      const tb = img.bitmap.data[topIdx + 2]!

      const br = img.bitmap.data[botIdx]!
      const bg = img.bitmap.data[botIdx + 1]!
      const bb = img.bitmap.data[botIdx + 2]!

      // ANSI TrueColor: \x1b[38;2;R;G;Bm (fg) + \x1b[48;2;R;G;Bm (bg) + ▀ + reset
      line += `\x1b[38;2;${br};${bg};${bb}m\x1b[48;2;${tr};${tg};${tb}m▀`
    }
    line += "\x1b[0m"
    lines.push(line)
  }

  return lines.join("\n")
}
