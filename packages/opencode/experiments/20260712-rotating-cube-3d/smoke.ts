/**
 * Rotating Cube — OpenTUI Three.js WebGPU Smoke Test
 *
 * Verifies end-to-end: CliRenderer → FrameBufferRenderable → ThreeCliRenderer
 * → Three.js Scene → WebGPU → terminal display.
 *
 * Run: bun run experiments/20260712-rotating-cube-3d/smoke.ts
 * (from packages/opencode/)
 *
 * Inspired by https://anomalyco-opentui.mintlify.app/guides/3d-rendering
 */

import * as Core from "@opentui/core"
import { ThreeCliRenderer } from "@opentui/three"
import {
  Scene,
  PerspectiveCamera,
  Mesh,
  BoxGeometry,
  MeshPhongMaterial,
  DirectionalLight,
  AmbientLight,
  PointLight,
} from "three"

// ── Configuration ──────────────────────────────────────────────────────────

const TERMINAL_TIMEOUT_MS = 60_000 // Auto-exit after 60s
const TARGET_FPS = 30
const CUBE_COLOR = 0x3b82f6 // Tailwind blue-500

// ── State ───────────────────────────────────────────────────────────────────

let rotationSpeed = { x: 0.01, y: 0.02 }
let applyScanlineFx = false
let running = true

// ── Initialization ──────────────────────────────────────────────────────────

console.error("Starting OpenTUI rotating cube smoke test...")
console.error(`Target FPS: ${TARGET_FPS}, timeout: ${TERMINAL_TIMEOUT_MS}ms`)

const renderer = await Core.createCliRenderer({
  targetFps: TARGET_FPS,
  exitOnCtrlC: true,
})

renderer.setBackgroundColor("#0a0a1a")
renderer.start()

const tw = renderer.terminalWidth
const th = renderer.terminalHeight

// ── Background Frame ────────────────────────────────────────────────────────

const background = new Core.BoxRenderable(renderer, {
  id: "cube-bg",
  width: tw,
  height: th,
  position: "absolute",
  left: 0,
  top: 0,
  backgroundColor: "#0a0a1a",
  borderStyle: "single",
  title: " 3D Rotating Cube ",
  titleAlignment: "center",
})
renderer.root.add(background)

// ── 3D Framebuffer ──────────────────────────────────────────────────────────

const framebuffer = new Core.FrameBufferRenderable(renderer, {
  id: "cube-fb",
  width: tw,
  height: th,
  zIndex: 10,
  respectAlpha: true,
})
renderer.root.add(framebuffer)

// ── Three.js Scene ──────────────────────────────────────────────────────────

const scene = new Scene()
const camera = new PerspectiveCamera(45, tw / th, 0.1, 100)
camera.position.z = 3.5

const geometry = new BoxGeometry(1.2, 1.2, 1.2)
const material = new MeshPhongMaterial({
  color: CUBE_COLOR,
  specular: 0x222222,
  shininess: 40,
})
const cube = new Mesh(geometry, material)
scene.add(cube)

// Lighting
const ambient = new AmbientLight(0xffffff, 0.25)
scene.add(ambient)

const directional = new DirectionalLight(0xffffff, 0.9)
directional.position.set(5, 5, 5)
scene.add(directional)

const point = new PointLight(0xff6b6b, 0.4, 100)
point.position.set(-3, 0, 3)
scene.add(point)

// ── ThreeCliRenderer ───────────────────────────────────────────────────────

const engine = new ThreeCliRenderer(renderer, {
  width: tw,
  height: th,
  scene,
  camera,
  autoResize: false,
} as any)

// ── Status Text ─────────────────────────────────────────────────────────────

const statusText = new Core.TextRenderable(renderer, {
  id: "cube-status",
  content:
    " ↑↓ speed X | ← → speed Y | Space: FX | Q: exit ",
  position: "absolute",
  left: Math.max(2, Math.floor(tw / 2) - 25),
  top: th - 2,
  fg: "#888899",
  zIndex: 20,
})
renderer.root.add(statusText)

// ── Keyboard Controls ───────────────────────────────────────────────────────

renderer.keyInput.on("keypress", (key: Core.KeyEvent) => {
  switch (key.name) {
    case "up":
      rotationSpeed.x = Math.min(rotationSpeed.x + 0.01, 0.5)
      break
    case "down":
      rotationSpeed.x = Math.max(rotationSpeed.x - 0.01, -0.5)
      break
    case "left":
      rotationSpeed.y = Math.max(rotationSpeed.y - 0.01, -0.5)
      break
    case "right":
      rotationSpeed.y = Math.min(rotationSpeed.y + 0.01, 0.5)
      break
    case "space":
      applyScanlineFx = !applyScanlineFx
      break
    case "q":
    case "escape":
      running = false
      break
  }
})

// ── Render Loop ─────────────────────────────────────────────────────────────

renderer.setFrameCallback(async (deltaTime: number) => {
  if (!running) {
    renderer.stop()
    return
  }

  // Rotate cube
  cube.rotation.x += rotationSpeed.x * (deltaTime / 16)
  cube.rotation.y += rotationSpeed.y * (deltaTime / 16)

  // Animate point light orbit
  const t = performance.now() * 0.001
  point.position.x = Math.sin(t * 0.8) * 3
  point.position.z = Math.cos(t * 0.8) * 3

  // Render 3D scene to framebuffer
  await (engine as any).render(framebuffer.frameBuffer, deltaTime)

  // Apply post-processing — applyScanlines is re-exported from @opentui/core
  if (applyScanlineFx) {
    const fx = (Core as any).applyScanlines
    if (typeof fx === "function") {
      fx(framebuffer.frameBuffer, 0.8)
    }
  }
})

// ── Auto-exit timer ─────────────────────────────────────────────────────────

setTimeout(() => {
  if (running) {
    console.error("\nSmoke test timed out — exiting.")
    running = false
    renderer.stop()
  }
}, TERMINAL_TIMEOUT_MS)

console.error("Rotating cube running. Controls: ↑↓←→ Space Q")
console.error(`Auto-exit in ${TERMINAL_TIMEOUT_MS / 1000}s.`)
