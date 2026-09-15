// Prototype of the IN-PRODUCT renderer: text -> SVG -> WebP via sharp.
//
// Why this test first: the whole "image mode" idea was validated with Python/PIL, but
// the product is TypeScript. The only already-present dependency able to rasterise text
// is `sharp` (used by attachment/handlers/image.ts). If sharp cannot produce a page the
// model reads, the architecture has to change (a Rust/WASM renderer, or shelling out to
// Python) - so this is the load-bearing unknown, and it is cheap to settle.
//
// Target geometry, from the live measurements:
//   page 1280 x 1260 px, advance 8 px, line pitch 15 px, 160 cols x 84 rows
//   = 13,440 characters per page, ~963 tokens, the measured budget point.
//
// Exactness matters: characters are positioned individually (x = col * 8, y = row * 15)
// so the pitch does not depend on the font's advance metrics.
//
// Run: bun experiments/2026-09-12_deepseek-vision/sharp-render.ts

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const DIR = join(import.meta.dir, "sharp-out")
const PAGE_W = 1280
const PAGE_H = 1260
const ADV = 8
const PITCH = 15
const COLS = PAGE_W / ADV // 160
const ROWS = PAGE_H / PITCH // 84
const CELLS = COLS * ROWS // 13440
const FONT_SIZE = 14

const SOURCE = join(import.meta.dir, "..", "..", "packages/opencode/src/session/prompt/reasoning_prompt.txt")

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/** One SVG text element per character, positioned on the exact grid. */
function pageSvg(chunk: string, fontFamily: string): string {
  const parts: string[] = []
  for (let index = 0; index < chunk.length && index < CELLS; index++) {
    const ch = chunk[index]!
    if (ch === " " || ch === "\n") continue
    const col = index % COLS
    const row = Math.floor(index / COLS)
    const x = col * ADV
    const y = row * PITCH + FONT_SIZE
    parts.push(`<text x="${x}" y="${y}">${escapeXml(ch)}</text>`)
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}">`,
    `<rect width="${PAGE_W}" height="${PAGE_H}" fill="#fff"/>`,
    `<g fill="#000" font-family="${fontFamily}" font-size="${FONT_SIZE}px" xml:space="preserve">`,
    parts.join(""),
    "</g></svg>",
  ].join("")
}

async function render(text: string, fontFamily: string): Promise<{ svg: number; webp: Buffer; png: Buffer }> {
  const { default: sharp } = await import("sharp")
  const svg = pageSvg(text, fontFamily)
  const buf = Buffer.from(svg)
  const webp = await sharp(buf, { density: 72 }).webp({ lossless: true, effort: 4 }).toBuffer()
  const png = await sharp(buf, { density: 72 }).png({ compressionLevel: 9 }).toBuffer()
  return { svg: buf.length, webp, png }
}

async function main() {
  mkdirSync(DIR, { recursive: true })
  const text = await Bun.file(SOURCE).text()
  console.log(`source: ${text.length} chars`)
  console.log(`page: ${PAGE_W}x${PAGE_H}, adv ${ADV}, pitch ${PITCH}, ${COLS} cols x ${ROWS} rows = ${CELLS} cells`)
  console.log("")

  const families = ["Consolas", "monospace", "Courier New"]
  for (const family of families) {
    const chunk = text.slice(0, CELLS)
    const t0 = Date.now()
    const { svg, webp, png } = await render(chunk, family)
    const ms = Date.now() - t0
    writeFileSync(join(DIR, `page-${family.replace(/ /g, "_")}.webp`), webp)
    console.log(
      `${family.padEnd(12)} svg ${String(svg).padStart(7)} B | webp ${String(webp.length).padStart(7)} B | png ${String(png.length).padStart(7)} B | ${ms} ms`,
    )
  }

  // Full document as pages, to size the whole pipeline.
  const total = Math.ceil(text.length / CELLS)
  console.log("")
  console.log(`document would need ${total} pages`)
  const t1 = Date.now()
  let bytes = 0
  for (let p = 0; p < total; p++) {
    const chunk = text.slice(p * CELLS, (p + 1) * CELLS)
    const { webp } = await render(chunk, "Consolas")
    writeFileSync(join(DIR, `doc-page${p + 1}.webp`), webp)
    bytes += webp.length
  }
  const ms = Date.now() - t1
  console.log(`rendered ${total} pages: ${bytes} B total, ${(bytes / total).toFixed(0)} B/page, ${ms} ms (${(ms / total).toFixed(0)} ms/page)`)
  console.log(`estimated tokens: ${total * 963}`)
  console.log("")
  console.log("artifacts in " + DIR)
}

main()
