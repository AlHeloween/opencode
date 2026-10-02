import { createCliRenderer, TextRenderable } from "../../packages/opentui/packages/core/src/index"

// Diagnostic only: exercise the real native renderer and the terminal's pixels.
const renderer = await createCliRenderer({
  useAlternateScreen: true,
  exitOnCtrlC: true,
  targetFps: 30,
})
const text = new TextRenderable(renderer, {
  id: "malayalam-diff-fixture",
  content: "",
})
renderer.root.add(text)
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const rows = (body: string) => Array.from({ length: 20 }, (_, i) => `${String(i).padStart(2)} ${body} | sidebar`).join("\n")
try {
  for (let frame = 0; frame < 8; frame++) {
    text.content = rows(frame % 2 === 0 ? "പരിശോധിക്കൽ" : "          ")
    await pause(350)
  }
  text.content = rows("ASCII clear") + "\nDIAGNOSTIC: no Malayalam should remain in this frame."
  await pause(60_000)
} finally {
  renderer.destroy()
}
