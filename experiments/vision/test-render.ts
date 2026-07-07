/**
 * Quick smoke test of the chafa-wasm render pipeline.
 * Run: bun run experiments/vision/test-render.ts
 */
import { readFileSync } from "fs"
import { detectBestProtocol } from "../../packages/opencode/src/util/terminal-graphics"
import { renderImageToTerminal } from "../../packages/opencode/src/util/chafa-wasm-render"

const imagePath = new URL("dragon.jpg", import.meta.url).pathname.replace(/^\/([A-Z]:\/)/, "$1")

async function main() {
  console.log("=== Terminal Graphics Detection ===")
  const protocol = detectBestProtocol()
  console.log(`Detected protocol: ${protocol}`)

  console.log("\n=== Loading image ===")
  const imageBytes = readFileSync(imagePath)
  console.log(`Image: ${imagePath} (${imageBytes.length} bytes)`)

  console.log("\n=== Rendering with detected protocol ===")
  const result = await renderImageToTerminal(imageBytes.buffer as ArrayBuffer, {
    protocol,
    width: 80,
    height: 24,
  })

  if (result) {
    console.log(`SUCCESS: ${result.length} chars output\n`)
    console.log(result)
  } else {
    console.log("FAILED: no output from renderImageToTerminal")
  }

  // Also try symbols fallback
  if (protocol !== "symbols") {
    console.log("\n\n=== Rendering with symbols fallback ===")
    const fallback = await renderImageToTerminal(imageBytes.buffer as ArrayBuffer, {
      protocol: "symbols",
      width: 80,
      height: 24,
    })
    if (fallback) {
      console.log(`SUCCESS: ${fallback.length} chars output`)
      console.log(fallback.substring(0, 200) + "...")
    } else {
      console.log("FAILED: symbols fallback also returned null")
    }
  }
}

main().catch((err) => {
  console.error("FATAL:", err)
  process.exit(1)
})
