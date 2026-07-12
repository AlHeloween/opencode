/**
 * Rotating Cube — OpenTUI Three.js WebGPU Smoke Test
 *
 * Uses ThreeRenderable (higher-level API) which wraps ThreeCliRenderer
 * internally — handles init(), frame callback registration, and buffer
 * management automatically.
 *
 * CRITICAL: Do NOT call renderer.setFrameCallback() after creating a
 * ThreeRenderable — it replaces the internal callback that drives rendering.
 * Animation must happen via setInterval or similar non-competing mechanism.
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
import { appendFileSync } from "fs"

// ── Logger ──────────────────────────────────────────────────────────────────
// Use sync file I/O to guarantee the log is flushed on every write.

const LOG_FILE = join(import.meta.dir, "smoke.log")

const LOG_BUF: string[] = []
let LOG_FLUSHED = false

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  process.stderr.write(line)
  LOG_BUF.push(line)
}

function logError(err: unknown): void {
  if (err instanceof Error) {
    log(`  name: ${err.name}`)
    log(`  message: ${err.message}`)
    log(`  stack: ${(err.stack ?? "(no stack)").split("\n").slice(0, 6).join("\n    ")}`)
    if (err.message?.includes("bun-webgpu") || err.message?.includes("WebGPU")) {
      log("  => bun-webgpu or WebGPU unavailable")
    }
  } else {
    log(`  raw: ${String(err)}`)
  }
}

function flushLog(): void {
  if (LOG_FLUSHED) return
  LOG_FLUSHED = true
  try {
    appendFileSync(LOG_FILE, LOG_BUF.join(""), "utf-8")
  } catch (e) {
    process.stderr.write(`[LOGFAIL] ${e}\n`)
  }
}

// ── Configuration ──────────────────────────────────────────────────────────

const TIMEOUT_MS = 30_000
const CUBE_COLOR = 0x3b82f6

// ── State ───────────────────────────────────────────────────────────────────

let speedX = 0.01
let speedY = 0.02
let scanlinesOn = false

// ── Init ────────────────────────────────────────────────────────────────────

log(`Log: ${LOG_FILE}`)
log(`Bun: ${Bun.version} rev ${Bun.revision}`)
log(`Platform: ${process.platform} arch: ${process.arch}`)
log(`CWD: ${process.cwd()}`)

const renderer = await Core.createCliRenderer({
  targetFps: 30,
  exitOnCtrlC: true,
})
renderer.setBackgroundColor("#0a0a1a")
renderer.start()

const tw = renderer.terminalWidth
const th = renderer.terminalHeight
log(`Terminal: ${tw}×${th}`)

// ── Scene ───────────────────────────────────────────────────────────────────

const scene = new Scene()
const camera = new PerspectiveCamera(45, tw / th, 0.1, 100)
camera.position.z = 3.5

const cube = new Mesh(
  new BoxGeometry(1.2, 1.2, 1.2),
  new MeshPhongMaterial({ color: CUBE_COLOR, specular: 0x222222, shininess: 40 }),
)
scene.add(cube)

scene.add(new AmbientLight(0xffffff, 0.25))

const dirLight = new DirectionalLight(0xffffff, 0.9)
dirLight.position.set(5, 5, 5)
scene.add(dirLight)

const pointLight = new PointLight(0xff6b6b, 0.4, 100)
pointLight.position.set(-3, 0, 3)
scene.add(pointLight)

log("Scene: cube + 3 lights")

// ── ThreeRenderable ─────────────────────────────────────────────────────────
// Registers its OWN frame callback via registerFrameCallback().
// Do NOT call renderer.setFrameCallback() afterwards — it would replace it.

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
  log("ThreeRenderable: OK (init lazy, frame callback registered)")
} catch (err) {
  log("ThreeRenderable: constructor FAILED")
  logError(err)
}

// ── Background (behind the 3D view) ─────────────────────────────────────────

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

// ThreeRenderable on top
if (threeRenderable) renderer.root.add(threeRenderable)

// ── Status text (on top of everything) ──────────────────────────────────────

const statusText = new Core.TextRenderable(renderer, {
  id: "cube-status",
  content: threeRenderable
    ? " ↑↓←→ speed | Space: FX | Q: exit "
    : " ThreeRenderable failed — see smoke.log | Q: exit ",
  position: "absolute",
  left: Math.max(2, Math.floor(tw / 2) - 25),
  top: th - 2,
  fg: "#888899",
  zIndex: 20,
})
renderer.root.add(statusText)

// ── Animation via setInterval ───────────────────────────────────────────────
// IMPORTANT: Do NOT use renderer.setFrameCallback() here — ThreeRenderable
// already registered its own. Animation state is updated independently and
// picked up by ThreeRenderable's render callback on each frame.

let animFrame = 0
const animTimer = setInterval(() => {
  animFrame++

  // Rotate
  cube.rotation.x += speedX
  cube.rotation.y += speedY

  // Orbit light
  const t = performance.now() * 0.001
  pointLight.position.x = Math.sin(t * 0.8) * 3
  pointLight.position.z = Math.cos(t * 0.8) * 3

  // Log first 5 animation ticks
  if (animFrame <= 5 || animFrame % 600 === 0) {
    log(`Anim #${animFrame}: rot=(${cube.rotation.x.toFixed(2)},${cube.rotation.y.toFixed(2)})`)
  }

  // Scanlines via ThreeRenderable's internal frameBuffer
  if (scanlinesOn && threeRenderable) {
    try {
      const fb = (threeRenderable as any).frameBuffer
      if (fb) {
        const fx = (Core as any).applyScanlines
        if (typeof fx === "function") fx(fb, 0.8)
      }
    } catch { /* best-effort */ }
  }
}, 33) // ~30fps

// ── Keyboard ────────────────────────────────────────────────────────────────

renderer.keyInput.on("keypress", (key: Core.KeyEvent) => {
  log(`Key: "${key.name}"`)
  switch (key.name) {
    case "up":    speedX = Math.min(speedX + 0.01, 0.5); break
    case "down":  speedX = Math.max(speedX - 0.01, -0.5); break
    case "left":  speedY = Math.max(speedY - 0.01, -0.5); break
    case "right": speedY = Math.min(speedY + 0.01, 0.5); break
    case "space": scanlinesOn = !scanlinesOn; break
    case "q":
    case "escape":
      log("Quit")
      clearInterval(animTimer)
      flushLog()
      try { renderer.stop() } catch {}
      process.exit(0)
  }
})

// ── Timeout ─────────────────────────────────────────────────────────────────

setTimeout(() => {
  log(`Timeout — ${animFrame} frames`)
  clearInterval(animTimer)
  flushLog()
  try { renderer.stop() } catch {}
  process.exit(0)
}, TIMEOUT_MS)

flushLog()
log("Live. Auto-exit in 30s.")
