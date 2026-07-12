/**
 * Rotating Cube — OpenTUI Three.js WebGPU Smoke Test
 *
 * Verifies end-to-end: CliRenderer → FrameBufferRenderable → ThreeCliRenderer
 * → Three.js Scene → WebGPU → terminal display.
 *
 * Run: bun run experiments/20260712-rotating-cube-3d/smoke.ts
 * (from packages/opencode/)
 *
 * Logs are written to smoke.log in the same directory for post-mortem analysis.
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
import { join, dirname } from "path"
import { fileURLToPath } from "url"

// ── Logger ──────────────────────────────────────────────────────────────────
// Logs to both stderr (live) and smoke.log (persistent, in the same folder).

const LOG_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "smoke.log",
)

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
  const line = `[${new Date().toISOString()}] ${"=".repeat(60)}\n`
  try {
    await Bun.write(Bun.file(LOG_FILE), line, { createPath: true })
  } catch {}
}

// ── Configuration ──────────────────────────────────────────────────────────

const TERMINAL_TIMEOUT_MS = 30_000
const TARGET_FPS = 30
const CUBE_COLOR = 0x3b82f6

// ── State ───────────────────────────────────────────────────────────────────

let rotationSpeed = { x: 0.01, y: 0.02 }
let applyScanlineFx = false

// ── Initialization ──────────────────────────────────────────────────────────

await writeSection("START smoke test")
await writeLog(`Log file: ${LOG_FILE}`)
await writeLog(`Target FPS: ${TARGET_FPS}, timeout: ${TERMINAL_TIMEOUT_MS}ms`)

// Log environment — useful for WebGPU diagnostics
await writeLog(`Bun: ${Bun.version} rev ${Bun.revision}`)
await writeLog(`Platform: ${process.platform} arch: ${process.arch}`)
await writeLog(`Node: ${process.version}`)
await writeLog(`CWD: ${process.cwd()}`)

// ── CliRenderer ─────────────────────────────────────────────────────────────

await writeLog("Calling createCliRenderer...")
let renderer: Core.CliRenderer
try {
  renderer = await Core.createCliRenderer({
    targetFps: TARGET_FPS,
    exitOnCtrlC: true,
  })
  await writeLog("createCliRenderer: OK")
} catch (err) {
  await writeLog(`createCliRenderer: FAILED — ${err}`)
  await writeLog("Aborting — cannot proceed without a renderer.")
  process.exit(1)
}

renderer.setBackgroundColor("#0a0a1a")
renderer.start()
await writeLog("renderer.start(): OK")

const tw = renderer.terminalWidth
const th = renderer.terminalHeight
await writeLog(`Terminal: ${tw}×${th}`)

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
await writeLog("BoxRenderable (background): OK")

// ── 3D Framebuffer ──────────────────────────────────────────────────────────

const framebuffer = new Core.FrameBufferRenderable(renderer, {
  id: "cube-fb",
  width: tw,
  height: th,
  zIndex: 10,
  respectAlpha: true,
})
renderer.root.add(framebuffer)
await writeLog("FrameBufferRenderable: OK")

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

const ambient = new AmbientLight(0xffffff, 0.25)
scene.add(ambient)

const directional = new DirectionalLight(0xffffff, 0.9)
directional.position.set(5, 5, 5)
scene.add(directional)

const point = new PointLight(0xff6b6b, 0.4, 100)
point.position.set(-3, 0, 3)
scene.add(point)

await writeLog("Three.js scene: OK (cube + 3 lights)")

// ── ThreeCliRenderer ───────────────────────────────────────────────────────

await writeSection("ThreeCliRenderer initialization")

let engine: ThreeCliRenderer | null = null
let webgpuAvailable = true

await writeLog("Checking @opentui/three exports...")
try {
  const threeMod = await import("@opentui/three")
  const exportNames = Object.keys(threeMod).sort().join(", ")
  await writeLog(`@opentui/three exports: ${exportNames}`)
} catch (err) {
  await writeLog(`@opentui/three import failed: ${err}`)
}

await writeLog("Constructing ThreeCliRenderer...")
await writeLog(`  width=${tw}, height=${th}, autoResize=false`)

let engineInitError: string | null = null

try {
  engine = new ThreeCliRenderer(renderer, {
    width: tw,
    height: th,
    autoResize: false,
  })
  await writeLog("ThreeCliRenderer: constructor OK")
} catch (err) {
  await writeLog(`ThreeCliRenderer: constructor FAILED`)
  await logError(err)
  webgpuAvailable = false
}

// ── Init (async WebGPU setup) ──────────────────────────────────────────────

if (webgpuAvailable && engine) {
  await writeLog("Calling engine.init()...")
  try {
    await engine.init()
    await writeLog("engine.init(): OK — WebGPU device + renderer ready")
    // Set our custom camera
    engine.setActiveCamera(camera)
    await writeLog("engine.setActiveCamera(camera): OK")
  } catch (err) {
    await writeLog("engine.init(): FAILED")
    await logError(err)
    engineInitError = err instanceof Error ? err.message : String(err)
    webgpuAvailable = false
  }
}

// ── FrameBuffer sanity check ────────────────────────────────────────────────

if (webgpuAvailable && engine) {
  await writeLog("Checking framebuffer.frameBuffer...")
  const fb = (framebuffer as any).frameBuffer
  if (fb) {
    await writeLog(`  frameBuffer: ${typeof fb} — OK`)
  } else {
    await writeLog(`  frameBuffer: undefined or null — drawScene() will likely fail`)
  }
}

// Check that drawScene exists
if (webgpuAvailable && engine) {
  await writeLog(`engine.drawScene: ${typeof (engine as any).drawScene}`)
  await writeLog(`engine.init available: ${typeof (engine as any).init}`)
  await writeLog(`engine.doDrawScene: ${typeof (engine as any).doDrawScene}`)
}

// ── Status Text ─────────────────────────────────────────────────────────────

const statusMsg = webgpuAvailable
  ? " ↑↓←→ speed | Space: FX | Q: exit "
  : " WebGPU unavailable — see smoke.log | Q: exit "

const statusText = new Core.TextRenderable(renderer, {
  id: "cube-status",
  content: statusMsg,
  position: "absolute",
  left: Math.max(2, Math.floor(tw / 2) - 25),
  top: th - 2,
  fg: "#888899",
  zIndex: 20,
})
renderer.root.add(statusText)
await writeLog("Status text rendered")

// ── Keyboard Controls ───────────────────────────────────────────────────────

renderer.keyInput.on("keypress", (key: Core.KeyEvent) => {
  writeLog(`Key pressed: name="${key.name}" ctrl=${key.ctrl} shift=${key.shift}`)
  switch (key.name) {
    case "up":
      rotationSpeed.x = Math.min(rotationSpeed.x + 0.01, 0.5)
      writeLog(`rotationSpeed.x -> ${rotationSpeed.x.toFixed(3)}`)
      break
    case "down":
      rotationSpeed.x = Math.max(rotationSpeed.x - 0.01, -0.5)
      writeLog(`rotationSpeed.x -> ${rotationSpeed.x.toFixed(3)}`)
      break
    case "left":
      rotationSpeed.y = Math.max(rotationSpeed.y - 0.01, -0.5)
      writeLog(`rotationSpeed.y -> ${rotationSpeed.y.toFixed(3)}`)
      break
    case "right":
      rotationSpeed.y = Math.min(rotationSpeed.y + 0.01, 0.5)
      writeLog(`rotationSpeed.y -> ${rotationSpeed.y.toFixed(3)}`)
      break
    case "space":
      applyScanlineFx = !applyScanlineFx
      writeLog(`applyScanlineFx -> ${applyScanlineFx}`)
      break
    case "q":
    case "escape":
      writeLog("QUIT requested via keyboard — calling renderer.stop()")
      try {
        renderer.stop()
        writeLog("renderer.stop(): returned OK")
      } catch (err) {
        writeLog(`renderer.stop(): THREW — ${err}`)
      }
      writeLog("Calling process.exit(0)")
      process.exit(0)
      break
  }
})

// ── Render Loop ─────────────────────────────────────────────────────────────

let frameCount = 0

renderer.setFrameCallback(async (deltaTime: number) => {
  frameCount++

  if (!engine || !webgpuAvailable) {
    if (frameCount === 1 || frameCount % 300 === 0) {
      writeLog(`Frame #${frameCount}: early return (no WebGPU), delta=${deltaTime.toFixed(2)}`)
    }
    return
  }

  // Log first frame and every 300th frame
  if (frameCount <= 3 || frameCount % 300 === 0) {
    writeLog(`Frame #${frameCount}: rendering, delta=${deltaTime.toFixed(2)}`)
  }

  // Rotate cube
  cube.rotation.x += rotationSpeed.x * (deltaTime / 16)
  cube.rotation.y += rotationSpeed.y * (deltaTime / 16)

  // Animate point light orbit
  const t = performance.now() * 0.001
  point.position.x = Math.sin(t * 0.8) * 3
  point.position.z = Math.cos(t * 0.8) * 3

  // Render 3D scene to framebuffer
  try {
    await engine.drawScene(scene, framebuffer.frameBuffer, deltaTime)
    if (frameCount === 1) {
      writeLog("engine.drawScene(): first call OK")
    }
  } catch (err) {
    writeLog(`Frame #${frameCount}: drawScene() FAILED`)
    await logError(err)
  }

  // Apply post-processing
  if (applyScanlineFx) {
    try {
      const fx = (Core as any).applyScanlines
      if (typeof fx === "function") {
        fx(framebuffer.frameBuffer, 0.8)
      }
    } catch { /* best-effort */ }
  }
})

// ── Auto-exit timer ─────────────────────────────────────────────────────────

setTimeout(async () => {
  await writeLog(`TIMEOUT after ${TERMINAL_TIMEOUT_MS}ms — force-exiting`)
  await writeLog(`Total frames rendered: ${frameCount}`)
  try {
    renderer.stop()
    await writeLog("renderer.stop(): called OK on timeout")
  } catch (err) {
    await writeLog(`renderer.stop(): threw on timeout — ${err}`)
  }
  await writeSection("END smoke test (timeout)")
  process.exit(0)
}, TERMINAL_TIMEOUT_MS)

await writeLog("Render loop registered. Test is live.")
await writeLog(`Auto-exit in ${TERMINAL_TIMEOUT_MS / 1000}s.`)
