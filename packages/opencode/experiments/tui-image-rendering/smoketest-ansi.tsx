/**
 * ANSI TrueColor smoketest — writes image directly to terminal, then OpenTUI overlay.
 */
import { createCliRenderer, TextRenderable } from "@opentui/core"
const j = await import("jimp") as any
const Jimp = j.Jimp

const IMAGE = process.argv[2] ?? "D:/zPython/opencode/experiments/vision/dragon.jpg"
const COLS = 60

// Load and resize image
const img = await Jimp.read(IMAGE)
const aspect = img.width / img.height
const rows = Math.round(COLS / aspect / 2)
img.resize({ w: COLS, h: rows * 2 })

// Build ANSI string
let ansi = ""
for (let y = 0; y < rows; y++) {
  for (let x = 0; x < COLS; x++) {
    const tr = img.bitmap.data[(y * 2 * COLS + x) * 4]!
    const tg = img.bitmap.data[(y * 2 * COLS + x) * 4 + 1]!
    const tb = img.bitmap.data[(y * 2 * COLS + x) * 4 + 2]!
    const br = img.bitmap.data[((y * 2 + 1) * COLS + x) * 4]!
    const bg = img.bitmap.data[((y * 2 + 1) * COLS + x) * 4 + 1]!
    const bb = img.bitmap.data[((y * 2 + 1) * COLS + x) * 4 + 2]!
    ansi += `\x1b[38;2;${br};${bg};${bb}m\x1b[48;2;${tr};${tg};${tb}m▀`
  }
  ansi += "\x1b[0m\n"
}

// Write directly to terminal (before OpenTUI takes over)
process.stdout.write("\x1b[2J\x1b[H") // clear screen
process.stdout.write(ansi)
process.stdout.write(`\n  \x1b[1;32m${IMAGE.split("/").pop()} — ${img.width}x${img.height} — ANSI TrueColor\x1b[0m\n`)
process.stdout.write("  Press Enter to exit...")

// Wait for Enter
process.stdin.setRawMode(true)
process.stdin.resume()
process.stdin.on("data", (d) => {
  if (d[0] === 13 || d[0] === 3 || d[0] === 27) { // Enter, Ctrl+C, Esc
    process.stdout.write("\x1b[2J\x1b[H")
    process.exit(0)
  }
})
