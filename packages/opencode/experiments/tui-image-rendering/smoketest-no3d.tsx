/** @jsxImportSource @opentui/solid */
import { render, extend, useKeyboard } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { TexturePlaneRenderable } from "../../src/cli/cmd/tui/component/texture-plane-renderable"

extend({ "image-plane": TexturePlaneRenderable })

function App() {
  useKeyboard((evt: any) => {
    if (evt.name === "escape") process.exit(0)
  })
  return (
    <box flexDirection="column" paddingLeft={2} paddingTop={1}>
      <text fg={RGBA.fromInts(0, 255, 0, 255)}>extend+TexturePlaneRenderable loads OK</text>
      <text fg={RGBA.fromInts(200, 200, 200, 255)}>Press Escape to exit</text>
    </box>
  )
}

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT:", err)
  process.exit(1)
})

render(() => <App />).catch((err: any) => {
  console.error("FATAL:", err?.stack || err)
  process.exit(1)
})
