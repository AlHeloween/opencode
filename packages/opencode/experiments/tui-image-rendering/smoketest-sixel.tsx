/** @jsxImportSource @opentui/solid */
/**
 * Sixel smoke test — visible terminal verification.
 * Run: bun run packages/opencode/experiments/tui-image-rendering/smoketest-sixel.tsx
 *
 * Renders a mermaid diagram via Sixel to terminal, with TUI placeholder rows.
 * You should SEE a flowchart. Press Escape to exit.
 */
import { render, useKeyboard } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { renderMermaidToPngDataUrl } from "../../src/util/mermaid"
import { renderDataUrlToTerminal } from "../../src/util/render-image-to-terminal"
import { createSignal, onMount } from "solid-js"

const source = [
  "flowchart LR",
  "  A[Sixel Test] --> B{Render OK?}",
  "  B -->|yes| C[Working]",
  "  B -->|no| D[Failed]",
].join("\n")

function App() {
  const [status, setStatus] = createSignal("Rendering...")
  const [rows, setRows] = createSignal(15)

  useKeyboard((evt: any) => {
    if (evt.name === "escape") process.exit(0)
  })

  onMount(async () => {
    try {
      const dataUrl = await renderMermaidToPngDataUrl(source, { theme: "default" })
      if (!dataUrl) { setStatus("FAIL: PNG generation failed"); return }

      const result = await renderDataUrlToTerminal(dataUrl, { protocol: "sixel", maxCols: 80 })
      if (result && result.protocol === "sixel") {
        setRows(result.dimensions.terminalRows)
        setStatus("OK — Sixel rendered above ↑")
      } else if (result && result.protocol === "symbols") {
        setStatus("WARN — Symbols fallback (terminal may not support Sixel)")
      } else {
        setStatus("FAIL: " + (result?.protocol ?? "null"))
      }
    } catch (e) {
      setStatus("ERROR: " + String(e))
    }
  })

  return (
    <box flexDirection="column" paddingLeft={2} paddingTop={1} gap={1}>
      <text fg={RGBA.fromInts(0, 255, 255, 255)}>Sixel Smoke Test</text>
      <text fg={RGBA.fromInts(200, 200, 200, 255)}>Press Escape to exit</text>
      <box height={rows()}>
        <text></text>
      </box>
      <text fg={RGBA.fromInts(100, 255, 100, 255)}>{status()}</text>
    </box>
  )
}

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT:", String(err?.stack || err))
  process.exit(1)
})

render(() => <App />)
