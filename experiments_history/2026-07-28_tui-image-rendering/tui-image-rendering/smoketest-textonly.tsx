import { createCliRenderer, TextRenderable, RGBA } from "@opentui/core"

const renderer = await createCliRenderer({ exitOnCtrlC: true, targetFps: 30 })

renderer.keyInput.on("keypress", (key: any) => {
  if (key.name === "escape") { renderer.destroy(); process.exit(0) }
})

const W = renderer.width
const H = renderer.height

renderer.root.add(new TextRenderable(renderer, {
  content: `TUI OK — ${W}x${H} — Press ESC to exit`,
  position: "absolute", left: 0, top: 0, fg: "#00FF00", zIndex: 100,
}))

renderer.root.add(new TextRenderable(renderer, {
  content: `Capabilities: ${JSON.stringify(renderer.capabilities)}`,
  position: "absolute", left: 0, top: 1, fg: "#FFFFFF", zIndex: 100,
}))

renderer.start()
