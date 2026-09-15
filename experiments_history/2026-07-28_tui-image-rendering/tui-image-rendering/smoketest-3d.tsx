/** @jsxImportSource @opentui/solid */
import { render, useKeyboard } from "@opentui/solid"
import { RGBA } from "@opentui/core"

const frame = new Uint8Array([
  20, 184, 166, 255, 20, 184, 166, 255,
  59, 130, 246, 255, 59, 130, 246, 255,
])

function App() {
  useKeyboard((event) => {
    if (event.name === "escape") process.exit(0)
  })

  return (
    <box flexDirection="column" paddingLeft={2} paddingTop={1} gap={1}>
      <text fg={RGBA.fromInts(20, 184, 166, 255)}>Native image smoke test</text>
      <text fg={RGBA.fromInts(200, 200, 200, 255)}>RGBA → ImageRenderable → synchronized graphics frame</text>
      <image data={frame} imageWidth={2} imageHeight={2} />
      <text fg={RGBA.fromInts(200, 200, 200, 255)}>Press Escape to exit</text>
    </box>
  )
}

render(() => <App />).catch((error) => {
  console.error("native image smoke test failed", error)
  process.exit(1)
})
