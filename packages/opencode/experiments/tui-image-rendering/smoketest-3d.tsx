/** @jsxImportSource @opentui/solid */
import { render, extend, useKeyboard } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { readFileSync, writeFileSync } from "fs"
import { TexturePlaneRenderable } from "../../src/cli/cmd/tui/component/texture-plane-renderable"

const log = (msg: string) => { try { writeFileSync("D:/zPython/opencode/.temp/smoketest-crash.log", msg + "\n", { flag: "a" }) } catch {} }

log("=== smoketest starting ===")

process.on("uncaughtException", (err) => { log("UNCAUGHT: " + String(err?.stack || err)); process.exit(1) })
process.on("unhandledRejection", (err) => { log("UNHANDLED: " + String(err)); process.exit(1) })

try {
  extend({ "image-plane": TexturePlaneRenderable })
  log("extend OK")
} catch(e) { log("extend FAILED: " + String(e)) }

const imagePath = process.argv[2] ?? "D:/zPython/opencode/experiments/vision/dragon.jpg"
const imageBytes = readFileSync(imagePath)
const base64 = imageBytes.toString("base64")
const isJpeg = imagePath.toLowerCase().endsWith(".jpg") || imagePath.toLowerCase().endsWith(".jpeg")
const dataUrl = `data:${isJpeg ? "image/jpeg" : "image/png"};base64,${base64}`

function App() {
  useKeyboard((evt: any) => {
    if (evt.name === "escape") process.exit(0)
  })
  return (
    <box flexDirection="column" paddingLeft={2} paddingTop={1} gap={1}>
      <text fg={RGBA.fromInts(0, 255, 255, 255)}>Smoketest 3D</text>
      <text fg={RGBA.fromInts(200, 200, 200, 255)}>Press Escape to exit</text>
      <image-plane url={dataUrl} mime={isJpeg ? "image/jpeg" : "image/png"} width={70} />
    </box>
  )
}

log("calling render()...")
render(() => <App />).then(() => {
  log("render resolved OK")
}).catch((err: any) => {
  log("FATAL: " + (err?.stack || err?.message || String(err)))
  process.exit(1)
})
