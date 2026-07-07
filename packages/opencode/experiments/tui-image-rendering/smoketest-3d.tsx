/** @jsxImportSource @opentui/solid */
/**
 * OpenTUI 3D Smoketest — standalone, no opencode needed.
 * Press Escape to exit. Shows dragon.jpg as textured 3D plane.
 *
 * Usage:
 *   bun run packages/opencode/experiments/tui-image-rendering/smoketest-3d.tsx
 *   smoketest-3d.bat
 */
import { render, extend, useKeyboard } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { readFileSync } from "fs"
import { TexturePlaneRenderable } from "../../src/cli/cmd/tui/component/texture-plane-renderable"

extend({ imagePlane: TexturePlaneRenderable })

const imagePath = process.argv[2] ?? "D:/zPython/opencode/experiments/vision/dragon.jpg"
const imageBytes = readFileSync(imagePath)
const base64 = imageBytes.toString("base64")
const isJpeg = imagePath.toLowerCase().endsWith(".jpg") || imagePath.toLowerCase().endsWith(".jpeg")
const dataUrl = `data:${isJpeg ? "image/jpeg" : "image/png"};base64,${base64}`
const fileName = imagePath.replace(/\\/g, "/").split("/").pop() ?? imagePath

function App() {
  useKeyboard((evt: any) => {
    if (evt.name === "escape") process.exit(0)
  })

  return (
    <box flexDirection="column" paddingLeft={2} paddingTop={1} gap={1}>
      <text fg={RGBA.fromInts(0, 255, 255, 255)}>
        OpenTUI 3D Smoketest — {fileName} ({imageBytes.length}B)
      </text>
      <text fg={RGBA.fromInts(200, 200, 200, 255)}>Press Escape to exit</text>
      <image-plane url={dataUrl} mime={isJpeg ? "image/jpeg" : "image/png"} width={70} />
      <text fg={RGBA.fromInts(100, 100, 100, 255)}>
        WebGPU: TextureUtils → PlaneGeometry → ThreeRenderable → blocks
      </text>
    </box>
  )
}

render(() => <App />).catch((err: any) => {
  console.error("FATAL:", err)
  process.exit(1)
})
