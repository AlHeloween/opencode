/**
 * Rotating Cube — OpenTUI Three.js WebGPU Smoke Test
 *
 * Uses ThreeRenderable (higher-level API) which wraps ThreeCliRenderer
 * internally — handles init(), frame callback registration, and buffer
 * management automatically.
 *
 * Run: bun run experiments/20260712-rotating-cube-3d/smoke.ts
 * (from packages/opencode/)
 *
 * Logs to smoke.log in the same directory.
 *
 * Inspired by https://anomalyco-opentui.mintlify.app/guides/3d-rendering
 */

import * as Core from "@opentui/core"
import { ThreeRenderable } from "@opentui/three"
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
import { join } from "path"

// ── Logger ──────────────────────────────────────────────────────────────────
// Bun provides import.meta.dir as the file's directory path directly.

const LOG_FILE = join(import.meta.dir, "smoke.log")

async function writeLog(entry: string): Promise<void> {
  const line = `[${new Date().toISOString()}] ${entry}\n`
  process.stderr.write(line)
  try {
    await Bun.write(Bun.file(LOG_FILE), line, { createPath: true })
  } catch (e) {
    process.stderr.write(`[LOGFAIL] ${e}\n`)
  }
}

async function logError(err: unknown): Promise<void> {
  if (err instanceof Error) {
    await writeLog(`  name: ${err.name}`)
    await writeLog(`  message: ${err.message}`)
    await writeLog(`  stack: ${(err.stack ?? "(no stack)").split("\n").slice(0, 8).join("\n    ")}`)
    if (err.message?.includes("bun-webgpu") || err.message?.includes("WebGPU")) {
      await writeLog("  => bun-webgpu or WebGPU unavailable. Need: Vulkan/DX12/Metal drivers + bun-webgpu@0.1.7")
    }
  } else {
    await writeLog(`  raw: ${String(err)}`)
  }
}

async function writeSection(title: string): Promise<void> {
  await writeLog(`\n${"=".repeat(60)}`)
  await writeLog(`  ${title}`)
  await writeLog(`=${"=".repeat(59)}`)
}

// ── Configuration ──────────────────────────────────────────────────────────

const TIMEOUT_MS = 30_000
const TARGET_FPS = 30
const CUBE_COLOR = 0x3b82f6

// ── State ───────────────────────────────────────────────────────────────────

let rotationY = 0
let rotationX = 0
let speedX = 0.01
let speedY = 0.02
let applyScanlineFx = false

// ── Init ────────────────────────────────────────────────────────────────────

await writeSection("START")
await writeLog(`Log: ${LOG_FILE}`)
await writeLog(`Bun: ${Bun.version} rev ${Bun.revision}`)
await writeLog(`Platform: ${process.platform} arch: ${process.arch}`)
await writeLog(`CWD: ${process.cwd()}`)

const renderer = await Core.createCliRenderer({
  targetFps: TARGET_FPS,
  exitOnCtrlC: true,
})
renderer.setBackgroundColor("#0a0a1a")
renderer.start()

const tw = renderer.terminalWidth
const th = renderer.terminalHeight
await writeLog(`Terminal: ${tw}×${th}`)

// ── Scene ───────────────────────────────────────────────────────────────────

const scene = new Scene()
const camera = new PerspectiveCamera(45, tw / th, 0.1, 100)
camera.position.z = 3.5

const cube = new Mesh(new BoxGeometry(1.2, 1.2, 1.2), new MeshPhongMaterial({
  color: CUBE_COLOR,
  specular: 0x222222,
  shininess: 40,
}))
scene.add(cube)

const ambient = new AmbientLight(0xffffff, 0.25)
scene.add(ambient)

const dirLight = new DirectionalLight(0xffffff, 0.9)
dirLight.position.set(5, 5, 5)
scene.add(dirLight)

const pointLight = new PointLight(0xff6b6b, 0.4, 100)
pointLight.position.set(-3, 0, 3)
scene.add(pointLight)

await writeLog("Scene: cube + 3 lights")

// ── ThreeRenderable (higher-level API) ──────────────────────────────────────
// ThreeRenderable wraps ThreeCliRenderer internally:
//   - Creates its own frameBuffer
//   - Calls engine.init() lazily on first render
//   - Registers its own frame callback for continuous rendering
//   - Renders scene + camera to its buffer on each frame
//   - Displays the buffer via renderSelf()

let threeRenderable: ThreeRenderable | null = null

try {
  threeRenderable = new ThreeRenderable(renderer, {
    id: "cube-view",
    scene,
    camera,
    width: tw,
    height: th,
    zIndex: 10,
    position: "absolute",
    left: 0,
    top: 0,
  })
  await writeLog("ThreeRenderable: constructor OK")
  await writeLog("  init is lazy — engine.init() called on first render frame")
} catch (err) {
  await writeLog("ThreeRenderable: constructor FAILED")
  await logError(err)
}

// ── Status text ─────────────────────────────────────────────────────────────

const statusOk = threeRenderable !== null
const statusText = new Core.TextRenderable(renderer, {
  id: "cube-status",
  content: statusOk
    ? " ↑↓←→ speed | Space: FX | Q: exit "
    : " ThreeRenderable failed — see smoke.log | Q: exit ",
  position: "absolute",
  left: Math.max(2, Math.floor(tw / 2) - 25),
  top: th - 2,
  fg: "#888899",
  zIndex: 20,
})
renderer.root.add(statusText)

// ── Keyboard ────────────────────────────────────────────────────────────────

renderer.keyInput.on("keypress", (key: Core.KeyEvent) => {
  writeLog(`Key: name="${key.name}" ctrl=${key.ctrl}`)
  switch (key.name) {
    case "up":    speedX = Math.min(speedX + 0.01, 0.5); break
    case "down":  speedX = Math.max(speedX - 0.01, -0.5); break
    case "left":  speedY = Math.max(speedY - 0.01, -0.5); break
    case "right": speedY = Math.min(speedY + 0.01, 0.5); break
    case "space": applyScanlineFx = !applyScanlineFx; break
    case "q":
    case "escape":
      writeLog("Quit — calling renderer.stop()")
      try { renderer.stop() } catch {}
      process.exit(0)
  }
})

// ── Background box ──────────────────────────────────────────────────────────

const bg = new Core.BoxRenderable(renderer, {
  id: "cube-bg",
  width: tw, height: th,
  position: "absolute", left: 0, top: 0,
  backgroundColor: "#0a0a1a",
  borderStyle: "single",
  title: " 3D Rotating Cube ",
  titleAlignment: "center",
})
renderer.root.add(bg)

// Add ThreeRenderable on top of background
if (threeRenderable) renderer.root.add(threeRenderable)

// ── Animation loop ──────────────────────────────────────────────────────────
// ThreeRenderable has its own frame callback for rendering. We use a separate
// timer to update the animation state (rotation, light position).

let frameCount = 0
renderer.setFrameCallback(async (deltaMs: number) => {
  frameCount++
  const dt = deltaMs / 16  // normalize to ~60fps frame units

  // Update animation state
  rotationX += speedX * dt
  rotationY += speedY * dt
  cube.rotation.x = rotationX
  cube.rotation.y = rotationY

  const t = performance.now() * 0.001
  pointLight.position.x = Math.sin(t * 0.8) * 3
  pointLight.position.z = Math.cos(t * 0.8) * 3

  // Log first 3 frames
  if (frameCount <= 3 || frameCount % 300 === 0) {
    await writeLog(`Frame #${frameCount}: rot=(${rotationX.toFixed(2)},${rotationY.toFixed(2)}) dt=${deltaMs.toFixed(1)}`)
  }

  // Apply scanlines via post-fx (re-exported from @opentui/core index)
  if (applyScanlineFx && threeRenderable) {
    try {
      const fb = (threeRenderable as any).frameBuffer
      if (fb) {
        const fx = (Core as any).applyScanlines
        if (typeof fx === "function") fx(fb, 0.8)
      }
    } catch { /* best-effort */ }
  }
})

// ── Timeout ─────────────────────────────────────────────────────────────────

setTimeout(async () => {
  await writeLog(`Timeout — ${frameCount} frames rendered`)
  try { renderer.stop() } catch {}
  await writeSection("END")
  process.exit(0)
}, TIMEOUT_MS)

await writeLog("Live. Auto-exit in 30s.")
