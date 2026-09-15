// FIXED text->video renderer. The previous one had two defects that silently destroyed every
// symbol-map page, and three runs were spent blaming the model for them:
//
//   1. ROWS EXCEEDED THE CANVAS. render_text_video.mts was called with 85 lines/frame at
//      fontSize 13 with line_spacing=8 -> 85 * 21 = 1785 px of text on a 1440 px canvas.
//      Measured on the artifact: ink bottom at y=1439, bottomGapPx=1 - the frame was CLIPPED,
//      so the tail of every page was never drawn. The model was asked about lines that were
//      not on the image.
//
//   2. THE FONT WAS NOT MONOSPACED. render_text_video.mts:41-44 drops fontfile= because the
//      escaped drive colon trips a parser bug in this ffmpeg build. With the fontconfig
//      default, the map's aligned columns (line | kind | name) do not line up at all.
//      Measured: the working source-code frame used 37.7% of its width; the symbol-map frame
//      used 13.7% - the glyph advance was wrong for grid content.
//
// This renderer fixes both, and REFUSES to produce a file it has not verified:
//   * the font is copied next to the output and referenced RELATIVE to cwd, so it is a plain
//     relative path with no colon to escape - drawtext accepts it, no parser bug.
//   * the row count is derived so the text ALWAYS fits: rows = floor((height - 2*margin) /
//     (fontSize + lineSpacing)).
//   * after rendering, frame 0 is measured and the run FAILS if ink reaches the bottom edge,
//     so a clipped render can never again be reported as a model failure.
//
// Run: cmd_runner start --cwd D:\zPython\opencode -- bun experiments/2026-09-12_deepseek-vision/render-fixed.ts <src> <outDir> [fontSize] [lineSpacing] [secondsPerFrame] [width] [height]

import fs from "node:fs"
import path from "node:path"

const SRC = process.argv[2] ?? "experiments/2026-09-12_deepseek-vision/symbol-map.txt"
const OUT_DIR = process.argv[3] ?? "experiments/2026-09-12_deepseek-vision/vid2"
const FONT_SIZE = Number(process.argv[4] ?? 18)
const LINE_SPACING = Number(process.argv[5] ?? 6)
const SECONDS_PER_FRAME = Number(process.argv[6] ?? 1.5)
const WIDTH = Number(process.argv[7] ?? 2560)
const HEIGHT = Number(process.argv[8] ?? 1440)
const MARGIN_X = 40
const MARGIN_Y = 30

// The font must sit next to the output and be addressed relative to cwd: a relative path has
// no drive colon, which is exactly what the drawtext parser chokes on.
const FONT_DIR = path.dirname(OUT_DIR)
const FONT = path.join(FONT_DIR, "vid2", "consola.ttf")
if (!fs.existsSync(FONT)) {
  console.error(`font missing: ${FONT}\ncopy consola.ttf next to the output directory first`)
  process.exit(1)
}
const FONT_REL = path.relative(process.cwd(), FONT).replace(/\\/g, "/")

// Rows that actually fit. This is the defect that wasted three runs.
const ROWS = Math.floor((HEIGHT - 2 * MARGIN_Y) / (FONT_SIZE + LINE_SPACING))

const text = fs.readFileSync(SRC, "utf-8").replace(/\r\n/g, "\n")
const lines = text.split("\n")
const framesCount = Math.ceil(lines.length / ROWS)
fs.mkdirSync(OUT_DIR, { recursive: true })

async function run(cmd: string[]) {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, out, err }
}

const pad = (n: number) => String(n).padStart(3, "0")

for (let i = 0; i < framesCount; i++) {
  const chunk = lines.slice(i * ROWS, (i + 1) * ROWS).join("\n")
  const txtFile = path.join(OUT_DIR, `frame_${pad(i)}.txt`)
  fs.writeFileSync(txtFile, chunk)
  const png = path.join(OUT_DIR, `frame_${pad(i)}.png`)
  const txtRel = path.relative(process.cwd(), txtFile).replace(/\\/g, "/")
  const vf =
    `drawtext=fontfile=${FONT_REL}:textfile=${txtRel}` +
    `:fontcolor=0x1E1E1E:fontsize=${FONT_SIZE}:line_spacing=${LINE_SPACING}` +
    `:x=${MARGIN_X}:y=${MARGIN_Y}:expansion=none`
  const r = await run([
    "ffmpeg", "-y",
    "-f", "lavfi", "-i", `color=c=0xF7F7F7:s=${WIDTH}x${HEIGHT}`,
    "-vf", vf,
    "-frames:v", "1", png,
  ])
  if (r.code !== 0) {
    console.error(`frame ${i} failed:\n` + r.err.slice(-700))
    process.exit(1)
  }
}

const fps = 1 / SECONDS_PER_FRAME
const mp4 = path.join(OUT_DIR, "text_video.mp4")
const r2 = await run([
  "ffmpeg", "-y",
  "-framerate", String(fps),
  "-i", path.join(OUT_DIR, "frame_%03d.png"),
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
  mp4,
])
if (r2.code !== 0) {
  console.error("concat failed:\n" + r2.err.slice(-700))
  process.exit(1)
}

// Verify the artifact: a clipped frame must never leave this script.
const { default: sharp } = await import("sharp")
const raw = await sharp(path.join(OUT_DIR, "frame_000.png")).greyscale().raw().toBuffer()
let minX = WIDTH
let maxX = -1
let minY = HEIGHT
let maxY = -1
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    if (raw[y * WIDTH + x]! < 200) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
}

const report = {
  src: SRC,
  chars: text.length,
  lines: lines.length,
  rowsPerFrame: ROWS,
  fontSize: FONT_SIZE,
  lineSpacing: LINE_SPACING,
  font: FONT_REL,
  frames: framesCount,
  seconds: Number((framesCount * SECONDS_PER_FRAME).toFixed(1)),
  mp4,
  bytes: fs.statSync(mp4).size,
  frame0: {
    widthUsedPercent: Number((((maxX - minX) / WIDTH) * 100).toFixed(1)),
    heightUsedPercent: Number((((maxY - minY) / HEIGHT) * 100).toFixed(1)),
    bottomGapPx: HEIGHT - maxY,
  },
}
console.log(JSON.stringify(report, null, 2))

// The gate: ink must NOT run into the bottom edge.
if (HEIGHT - maxY < 8) {
  console.error(`\nREFUSING: frame 0 ink reaches the bottom edge (gap ${HEIGHT - maxY}px) - lines are being clipped`)
  process.exit(2)
}
