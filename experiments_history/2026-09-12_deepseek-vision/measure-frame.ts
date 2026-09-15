// Measure MY OWN rendered frame before blaming the model.
//
// Three video runs failed on the symbol map while the same renderer scored 2/2 on source
// code. The difference could be the content - or it could be that the symbol-map frames were
// never legible in the first place. That is checkable locally, with no API call.
//
// What this measures on a rendered PNG:
//   * ink bounding box: if ink stops well above the bottom edge while the frame was supposed
//     to hold N lines, the text was CLIPPED and the model never saw the tail.
//   * horizontal fill: how much of the canvas width the text actually occupies. A frame that
//     uses a small fraction of its width is downscaled hard by the provider, and glyphs stop
//     being resolvable.
//   * the last visible line versus the last line the frame was given.
//
// Run: bun experiments/2026-09-12_deepseek-vision/measure-frame.ts <png> <txt>

import fs from "node:fs"
import path from "node:path"

const PNG = process.argv[2] ?? path.join(import.meta.dir, "symbol-video-short", "frame_000.png")
const TXT = process.argv[3] ?? path.join(import.meta.dir, "symbol-video-short", "frame_000.txt")

const { default: sharp } = await import("sharp")
const image = sharp(PNG).greyscale()
const meta = await image.metadata()
const raw = await image.raw().toBuffer()
const width = meta.width!
const height = meta.height!

// Ink = any pixel meaningfully darker than the 0xF7F7F7 background.
let minX = width
let maxX = -1
let minY = height
let maxY = -1
let ink = 0

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (raw[y * width + x]! < 200) {
      ink++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
}

const lines = fs.readFileSync(TXT, "utf-8").split(/\r?\n/)
const filled = lines.filter((l) => l.trim().length > 0)

const report = {
  png: path.relative(process.cwd(), PNG),
  canvas: `${width}x${height}`,
  givenLines: lines.length,
  nonEmptyLines: filled.length,
  inkPixels: ink,
  inkPercent: Number(((100 * ink) / (width * height)).toFixed(3)),
  inkBox: { x: [minX, maxX], y: [minY, maxY] },
  widthUsedPercent: Number((((maxX - minX) / width) * 100).toFixed(1)),
  heightUsedPercent: Number((((maxY - minY) / height) * 100).toFixed(1)),
  bottomGapPx: height - maxY,
  firstLine: filled[0]?.slice(0, 60),
  lastLine: filled.at(-1)?.slice(0, 60),
  verdict:
    height - maxY < 30 && filled.length > 20
      ? "text runs to the bottom edge - the frame was clipped, later lines never rendered"
      : "text ends above the bottom edge - not clipped",
}

console.log(JSON.stringify(report, null, 2))
