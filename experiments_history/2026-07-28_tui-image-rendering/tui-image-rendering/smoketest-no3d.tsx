/** @jsxImportSource @opentui/solid */
import { render, useKeyboard } from "@opentui/solid"
import { RGBA } from "@opentui/core"

function App() {
  useKeyboard((event) => {
    if (event.name === "escape") process.exit(0)
  })

  return (
    <box flexDirection="column" paddingLeft={2} paddingTop={1}>
      <text fg={RGBA.fromInts(0, 255, 0, 255)}>Native ImageRenderable loads without Three.js</text>
      <text fg={RGBA.fromInts(200, 200, 200, 255)}>Press Escape to exit</text>
    </box>
  )
}

render(() => <App />).catch((error) => {
  console.error("native image smoke test failed", error)
  process.exit(1)
})
