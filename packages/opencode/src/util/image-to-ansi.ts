/**
 * Pure ANSI TrueColor image renderer — no WebGPU, no Three.js.
 * Uses Jimp for image decoding + half-block characters for 2x vertical resolution.
 * Works in ANY terminal with TrueColor support (WezTerm, Windows Terminal, kitty, etc.)
 *
 * Algorithm: for each pair of rows (top, bottom), emit ▀ with
 *   fg=bottom_color, bg=top_color → one char = two pixels vertically.
 */

export interface AnsiImageOptions {
  width: number       // target width in columns
  height?: number     // target height in rows (auto-calculated from aspect ratio)
}

export async function imageToAnsi(
  imagePath: string,
  options: AnsiImageOptions
): Promise<string> {
  const j = await import("jimp") as any
  const Jimp = j.Jimp
  const img = await Jimp.read(imagePath)

  const aspect = img.width / img.height
  const cols = options.width
  // Each row = 2 pixels (half-block), so we need cols × rows × 2 pixels
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
