/**
 * Sixel smoke test — tests the actual app pipeline:
 *   mermaid WASM → SVG → resvg → PNG → renderDataUrlToTerminal(protocol=sixel) → terminal
 *
 * Run: bun run packages/opencode/experiments/tui-image-rendering/smoketest-sixel.tsx
 */
import { renderMermaidToPngDataUrl } from "../../src/util/mermaid"
import { renderDataUrlToTerminal } from "../../src/util/render-image-to-terminal"

const SOURCE = [
  "flowchart LR",
  "  A[Mermaid] --> B[resvg SVG]",
  "  B --> C[PNG data URL]",
  "  C --> D[Sixel terminal]",
  "  D --> E[OK]",
].join("\n")

async function main() {
  console.log("=== Sixel Pipeline Test ===\n")

  // Step 1: mermaid → PNG
  console.log("1. mermaid → PNG...")
  const dataUrl = await renderMermaidToPngDataUrl(SOURCE, { theme: "default" })
  if (!dataUrl) { console.log("FAIL: renderMermaidToPngDataUrl returned null"); process.exit(1) }
  console.log(`   OK (${dataUrl.length} chars)\n`)

  // Step 2: PNG → Sixel
  console.log("2. PNG → Sixel (protocol=sixel)...")
  const result = await renderDataUrlToTerminal(dataUrl, { protocol: "sixel", maxCols: 80 })
  if (!result) { console.log("FAIL: null result\n"); process.exit(1) }

  console.log(`   protocol: ${result.protocol}`)
  console.log(`   dimensions: ${result.dimensions.cols}×${result.dimensions.rows} pixels, ${result.dimensions.terminalRows} terminal rows\n`)

  if (result.protocol === "sixel") {
    console.log("OK — full pipeline works: mermaid→resvg→PNG→Sixel")
    console.log("You should see a flowchart above this line ↑")
  } else if (result.protocol === "symbols") {
    console.log("WARN — fell back to symbols. Terminal may not support Sixel.")
    console.log("      Sixel needs: Windows Terminal 2024+, foot, Konsole, xterm-sixel")
  } else {
    console.log("FAIL: unexpected protocol")
  }
}

main().catch((e) => {
  console.error("FATAL:", e?.stack || e?.message || String(e))
  process.exit(1)
})
