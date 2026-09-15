/** @jsxImportSource @opentui/solid */
import { render } from "@opentui/solid"

const pixel = new Uint8Array([59, 130, 246, 255])

function App() {
  return (
    <box flexDirection="column" paddingLeft={2} paddingTop={1} gap={1}>
      <text>Native graphics smoke test</text>
      <text>Image rendering no longer initializes WebGPU.</text>
      <image data={pixel} imageWidth={1} imageHeight={1} />
    </box>
  )
}

render(() => <App />).catch((error) => {
  console.error("native graphics smoke test failed", error)
  process.exit(1)
})
