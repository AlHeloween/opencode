/** @jsxImportSource @opentui/solid */
import { render, useKeyboard } from "@opentui/solid"
import { RGBA } from "@opentui/core"

function App() {
  useKeyboard((evt: any) => {
    if (evt.name === "escape") process.exit(0)
  })
  return (
    <box flexDirection="column" paddingLeft={2} paddingTop={1}>
      <text fg={RGBA.fromInts(0, 255, 0, 255)}>OpenTUI minimal test — OK</text>
      <text fg={RGBA.fromInts(200, 200, 200, 255)}>Press Escape to exit</text>
    </box>
  )
}

render(() => <App />).catch((err: any) => {
  console.error("FATAL:", err)
  process.exit(1)
})
