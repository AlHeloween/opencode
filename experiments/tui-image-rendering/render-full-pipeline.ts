/**
 * Full pipeline test: chafa-wasm → ANSI/Kitty string → stdout
 *
 * This replicates exactly what media-image.tsx does when rendering an image.
 * Run inside WezTerm to see Kitty protocol in action.
 *
 * Usage:
 *   bun run experiments/tui-image-rendering/render-full-pipeline.ts
 *   bun run experiments/tui-image-rendering/render-full-pipeline.ts --protocol kitty
 *   bun run experiments/tui-image-rendering/render-full-pipeline.ts --protocol sixel
 *   bun run experiments/tui-image-rendering/render-full-pipeline.ts --protocol symbols
 */
import { readFileSync } from "fs"
import { resolve } from "path"
import { detectBestProtocol } from "../../packages/opencode/src/util/terminal-graphics"
import { renderImageToTerminal } from "../../packages/opencode/src/util/chafa-wasm-render"

const imagePath = resolve(import.meta.dirname ?? ".", "..", "vision", "dragon.jpg")

const args = process.argv.slice(2)
const protocolOverride = args.includes("--protocol")
  ? args[args.indexOf("--protocol") + 1]
  : undefined

async function main() {
  // ── Terminal detection ──────────────────────────────────────────
  const protocol = detectBestProtocol(protocolOverride)
  console.error(`=== Terminal: ${process.env["TERM_PROGRAM"] ?? "unknown"} ===`)
  console.error(`=== Protocol: ${protocol} ===`)
  console.error(`=== Image: ${imagePath} ===`)

  // ── Load image ──────────────────────────────────────────────────
  const imageBytes = readFileSync(imagePath)
  console.error(`=== Size: ${imageBytes.length} bytes ===\n`)

  // ── Render (same call as media-image.tsx) ───────────────────────
  const cols = 80
  const rows = 24

  const result = await renderImageToTerminal(imageBytes.buffer as ArrayBuffer, {
    protocol,
    width: cols,
    height: rows,
  })

  if (!result) {
    console.error("FAILED: renderImageToTerminal returned null")
    process.exit(1)
  }

  // ── Output ──────────────────────────────────────────────────────
  // Check what kind of escape codes we got
  const hasKitty = result.includes("\x1b_G")
  const hasSixel = result.includes("\x1bPq")
  const hasAnsi = result.includes("\x1b[38;2;")

  console.error(`=== Output: ${result.length} chars ===`)
  console.error(`=== Kitty codes: ${hasKitty} ===`)
  console.error(`=== Sixel codes: ${hasSixel} ===`)
  console.error(`=== ANSI colors: ${hasAnsi} ===`)
  console.error("")

  // Write the actual output to stdout for the terminal to render
  process.stdout.write(result)
  process.stdout.write("\n")
}

main().catch((err) => {
  console.error("FATAL:", err)
  process.exit(1)
})
