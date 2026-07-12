/**
 * Image smoke test — renders a solid color to the terminal.
 *
 * Minimal test: full-screen flat color via ThreeCliRenderer. No textures,
 * no geometry complexity, no supersampling (superSample: "none").
 *
 * Run: cd packages/opencode && bun run experiments/20260712-rotating-cube-3d/image-smoke.ts
 */

import * as Core from "@opentui/core"
import { join } from "path"
import { appendFileSync } from "fs"

const LOG = join(import.meta.dir, "image-smoke.log")
const BUF: string[] = []
function log(m: string) { const l = `[${new Date().toISOString()}] ${m}\n`; process.stderr.write(l); BUF.push(l) }
function flush() { try { appendFileSync(LOG, BUF.join(""), "utf-8") } catch {} }

log(`Log: ${LOG}`)
log(`Bun ${Bun.version} on ${process.platform} ${process.arch}`)

const renderer = await Core.createCliRenderer({ targetFps: 15, exitOnCtrlC: true })
renderer.setBackgroundColor("#0a0a1a")
renderer.start()
const tw = renderer.terminalWidth, th = renderer.terminalHeight
log(`Terminal: ${tw}×${th}`)

const THREE = await import("three") as any
const opentui3d = await import("@opentui/three") as any

// Minimal scene: flat blue full-screen quad
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x3b82f6) // solid blue

// Add a simple rotating colored cube to verify geometry renders
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshBasicMaterial({ color: 0xff6b6b }),
)
scene.add(cube)

const camera = new THREE.PerspectiveCamera(45, tw / th, 0.1, 100)
camera.position.z = 3

// Framebuffer
const fbR = new Core.FrameBufferRenderable(renderer, {
  id: "img-fb", width: tw, height: th,
  position: "absolute", left: 0, top: 0,
  zIndex: 10, respectAlpha: true,
})

// Try CPU supersampling — native drawSuperSampleBuffer bypasses the JS pixel loop
const engine = new opentui3d.ThreeCliRenderer(renderer, {
  width: tw, height: th,
  superSample: "cpu",
  autoResize: false,
})
await engine.init()
engine.setActiveCamera(camera)
log("ThreeCliRenderer ready (cpu supersampling)")

// Layout
const bg = new Core.BoxRenderable(renderer, {
  id: "bg", width: tw, height: th,
  position: "absolute", left: 0, top: 0,
  backgroundColor: "#0a0a1a", borderStyle: "single",
  title: " Image Smoke Test ", titleAlignment: "center",
})
renderer.root.add(bg)
renderer.root.add(fbR)

new Core.TextRenderable(renderer, {
  id: "status", content: " Q: exit ",
  position: "absolute", left: Math.floor(tw / 2) - 4, top: th - 2,
  fg: "#888899", zIndex: 20,
})

// Test 1: Direct buffer write — verify FrameBufferRenderable display works
// Must use RGBA.fromValues() — plain objects fail at the native FFI boundary.
const buf = fbR.frameBuffer
const RGBA = (Core as any).RGBA
const greenC = RGBA.fromValues(0, 1, 0, 1)
const blackC = RGBA.fromValues(0, 0, 0, 1)
for (let y = 5; y < 10; y++) {
  for (let x = 5; x < 30; x++) {
    buf.setCellWithAlphaBlending(x, y, "\u2588", greenC, blackC)
  }
}
log("Direct buffer write: OK (green bar)")

// Render WebGPU scene (now with D3D12 backend since DXC is available)
await engine.drawScene(scene, buf, 0.016)
log("drawScene: OK")

// Idle
renderer.keyInput.on("keypress", (key: Core.KeyEvent) => {
  if (key.name === "q" || key.name === "escape") {
    log("Quit"); flush(); try { renderer.stop() } catch {}; process.exit(0)
  }
})
setTimeout(() => { log("Timeout"); flush(); try { renderer.stop() } catch {}; process.exit(0) }, 30000)
flush()
log("Solid color rendered. 30s timeout.")
