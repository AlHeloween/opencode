/** @jsxImportSource @opentui/solid */
/**
 * OpenTUI 3D Smoketest — renders dragon.jpg as a textured 3D plane.
 *
 * Verifies: createCliRenderer → extend(imagePlane) → <image-plane>
 * → TexturePlaneRenderable → ThreeRenderable → WebGPU → OpenTUI blocks.
 *
 * Auto-exits after 3 seconds.
 *
 * Usage:
 *   bun run packages/opencode/experiments/tui-image-rendering/smoketest-3d.tsx
 *   bun run packages/opencode/experiments/tui-image-rendering/smoketest-3d.tsx -- path/to/image.jpg
 */
import { render, extend } from "@opentui/solid"
import { createCliRenderer } from "@opentui/core"
import { RGBA } from "@opentui/core"
import { onMount } from "solid-js"
import { readFileSync } from "fs"
import { TexturePlaneRenderable } from "../../src/cli/cmd/tui/component/texture-plane-renderable"

// ── Register custom renderable ───────────────────────────────────
extend({ imagePlane: TexturePlaneRenderable })

// ── Load image ───────────────────────────────────────────────────
const imagePath = process.argv[2] ?? "D:/zPython/opencode/experiments/vision/dragon.jpg"
const imageBytes = readFileSync(imagePath)
const base64 = imageBytes.toString("base64")
const isJpeg = imagePath.toLowerCase().endsWith(".jpg") || imagePath.toLowerCase().endsWith(".jpeg")
const mime = isJpeg ? "image/jpeg" : "image/png"
const dataUrl = `data:${mime};base64,${base64}`
const fileName = imagePath.replace(/\\/g, "/").split("/").pop() ?? imagePath

// ── Root component ───────────────────────────────────────────────
function App() {
  onMount(() => {
    setTimeout(() => process.exit(0), 3000)
  })

  return (
    <box flexDirection="column" paddingLeft={2} paddingTop={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={RGBA.fromInts(0, 255, 255, 255)}>OpenTUI 3D Smoketest</text>
        <text fg={RGBA.fromInts(150, 150, 150, 255)}>3s | esc to exit</text>
      </box>
      <text fg={RGBA.fromInts(200, 200, 200, 255)}>
        {fileName} ({imageBytes.length} bytes)
      </text>
      <image-plane url={dataUrl} mime={mime} width={70} />
      <text fg={RGBA.fromInts(100, 100, 100, 255)}>
        Pipeline: TextureUtils → PlaneGeometry → ThreeRenderable → WebGPU → OpenTUI
      </text>
    </box>
  )
}

// ── Bootstrap ────────────────────────────────────────────────────
async function main() {
  console.error(`Loading: ${imagePath} (${imageBytes.length} bytes)`)

  const renderer = await createCliRenderer({
    externalOutputMode: "passthrough",
    targetFps: 30,
    autoFocus: false,
  })

  await render(() => <App />)
  console.error("Done.")
}

main().catch((err) => {
  console.error("FATAL:", err)
  process.exit(1)
})
