/**
 * Structural renderings of a picture, for GUI work.
 *
 * The screenshots we argue about are rasters; a GUI change has to be stated in the
 * picture's OWN coordinates. This module turns a decoded frame into three things:
 * ink bands (rows/columns carrying content, in pixels), a half-block text map (the
 * picture readable as text), and an SVG with the raster plus the structure — and
 * any planned boxes — drawn on top. Pure: decoding and file writes stay in the tool.
 */

export type Band = { start: number; end: number }

export type Outline = {
  width: number
  height: number
  /** Horizontal bands carrying ink — the text rows of the picture. */
  rows: Band[]
  /** Vertical bands carrying ink — the columns of the picture. */
  cols: Band[]
  /** Share of pixels above the ink threshold. */
  density: number
}

export type DiagramBox = { x: number; y: number; w: number; h: number; label: string; color?: string }

const INK = 40

/** Rec.601 luminance, one byte per pixel. */
export function toGray(rgba: Uint8Array | Buffer, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height)
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (rgba[p]! * 299 + rgba[p + 1]! * 587 + rgba[p + 2]! * 114) / 1000
  }
  return out
}

function runs(fraction: number[], minInk: number): Band[] {
  const out: Band[] = []
  let start = -1
  for (let i = 0; i <= fraction.length; i++) {
    const on = i < fraction.length && fraction[i]! > minInk
    if (on && start < 0) start = i
    if (!on && start >= 0) {
      out.push({ start, end: i - 1 })
      start = -1
    }
  }
  return out
}

export function outlineFromGray(
  gray: Uint8Array,
  width: number,
  height: number,
  opts: { threshold?: number; minInk?: number } = {},
): Outline {
  const threshold = opts.threshold ?? INK
  const minInk = opts.minInk ?? 0.01
  const rowInk = new Array<number>(height).fill(0)
  const colInk = new Array<number>(width).fill(0)
  let ink = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (gray[y * width + x]! > threshold) {
        ink++
        rowInk[y]!++
        colInk[x]!++
      }
    }
  }
  return {
    width,
    height,
    rows: runs(
      rowInk.map((n) => n / Math.max(1, width)),
      minInk,
    ),
    cols: runs(
      colInk.map((n) => n / Math.max(1, height)),
      minInk,
    ),
    density: width * height > 0 ? ink / (width * height) : 0,
  }
}

/** Box-average the picture to `cols` columns and render two pixel rows per text row. */
export function halfBlockMap(gray: Uint8Array, width: number, height: number, cols: number): string {
  const c = Math.max(8, Math.min(Math.round(cols), width))
  const rows = Math.max(1, Math.ceil(((height * c) / width) / 2))
  const grid = new Array<number>(c * rows * 2).fill(0)
  for (let ry = 0; ry < rows * 2; ry++) {
    for (let cx = 0; cx < c; cx++) {
      const x0 = Math.floor((cx * width) / c)
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * width) / c))
      const y0 = Math.floor((ry * height) / (rows * 2))
      const y1 = Math.max(y0 + 1, Math.floor(((ry + 1) * height) / (rows * 2)))
      let sum = 0
      let n = 0
      for (let y = y0; y < y1 && y < height; y++) {
        for (let x = x0; x < x1 && x < width; x++) {
          sum += gray[y * width + x]!
          n++
        }
      }
      grid[ry * c + cx] = n > 0 ? sum / n : 0
    }
  }
  const lines: string[] = []
  for (let ry = 0; ry < rows; ry++) {
    let line = ""
    for (let cx = 0; cx < c; cx++) {
      const top = grid[ry * 2 * c + cx]! > INK
      const bot = grid[(ry * 2 + 1) * c + cx]! > INK
      line += top && bot ? "█" : top ? "▀" : bot ? "▄" : " "
    }
    lines.push(line)
  }
  return lines.join("\n")
}

export function outlineToText(outline: Outline): string {
  const span = (b: Band) => `${b.start}-${b.end}`
  return (
    `${outline.width}x${outline.height}, ink ${(outline.density * 100).toFixed(1)}%\n` +
    `rows (${outline.rows.length}): ${outline.rows.map(span).join(", ") || "none"}\n` +
    `cols (${outline.cols.length}): ${outline.cols.map(span).join(", ") || "none"}`
  )
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/**
 * The raster as a faint background, the detected bands, and the caller's boxes —
 * a GUI change stated in the picture's own pixel coordinates.
 */
export function outlineToSvg(input: { outline: Outline; dataUrl: string; boxes?: DiagramBox[] }): string {
  const { outline, dataUrl, boxes = [] } = input
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outline.width}" height="${outline.height}" viewBox="0 0 ${outline.width} ${outline.height}">`,
    `<image href="${dataUrl}" x="0" y="0" width="${outline.width}" height="${outline.height}" opacity="0.45"/>`,
  ]
  for (const band of outline.rows) {
    parts.push(
      `<rect x="0" y="${band.start}" width="${outline.width}" height="${band.end - band.start + 1}" fill="none" stroke="#2e7d32" stroke-width="1" stroke-dasharray="4 3"/>`,
    )
  }
  for (const band of outline.cols) {
    parts.push(
      `<rect x="${band.start}" y="0" width="${band.end - band.start + 1}" height="${outline.height}" fill="none" stroke="#1565c0" stroke-width="1" stroke-dasharray="4 3"/>`,
    )
  }
  for (const box of boxes) {
    const color = box.color ?? "#c62828"
    parts.push(
      `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="none" stroke="${color}" stroke-width="2"/>`,
    )
    parts.push(
      `<text x="${box.x + 4}" y="${Math.max(12, box.y + 14)}" fill="${color}" font-family="monospace" font-size="12">${escapeXml(box.label)}</text>`,
    )
  }
  parts.push("</svg>")
  return parts.join("\n")
}
