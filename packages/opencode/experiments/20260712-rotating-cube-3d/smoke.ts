/**
 * Rotating Cube — OpenTUI Three.js WebGPU Smoke Test
 *
 * Uses ThreeCliRenderer + FrameBufferRenderable directly (not ThreeRenderable,
 * which has a design issue where renderSelf() returns early when the frame
 * callback is registered, leaving the buffer undisplayed).
 *
 * Pipeline: setInterval(33ms) → animate scene → drawScene → framebuffer → TUI
 *
 * Run: cd packages/opencode && bun run experiments/20260712-rotating-cube-3d/smoke.ts
 * Logs to smoke.log in the same directory (sync fs append).
 */

import * as Core from "@opentui/core"
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

const LOG_FILE = join(import.meta.dir, "smoke.log")
const LOG_BUF: string[] = []
let FLUSHED = false

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  process.stderr.write(line)
  LOG_BUF.push(line)
}
function logError(err: unknown): void {
  if (err instanceof Error) {
    log(`  name: ${err.name}`)
    log(`  message: ${err.message}`)
    log(`  stack: ${err.stack?.split("\n").slice(0, 4).join("\n    ") ?? "(none)"}`)
  } else {
    log(`  raw: ${String(err)}`)
  }
}
function flush(): void {
  if (FLUSHED) return
  FLUSHED = true
  try { appendFileSync(LOG_FILE, LOG_BUF.join(""), "utf-8") } catch (e) { process.stderr.write(`[LOGFAIL] ${e}\n`) }
}

// ── Init ────────────────────────────────────────────────────────────────────

log(`Log: ${LOG_FILE}`)
log(`Bun: ${Bun.version} rev ${Bun.revision}  Platform: ${process.platform} ${process.arch}`)

const renderer = await Core.createCliRenderer({ targetFps: 30, exitOnCtrlC: true })
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
  new MeshPhongMaterial({ color: 0x3b82f6, specular: 0x222222, shininess: 40 }),
)
scene.add(cube)
scene.add(new AmbientLight(0xffffff, 0.25))
const dl = new DirectionalLight(0xffffff, 0.9)
dl.position.set(5, 5, 5)
scene.add(dl)
const pl = new PointLight(0xff6b6b, 0.4, 100)
pl.position.set(-3, 0, 3)
scene.add(pl)
log("Scene ready: cube + 3 lights")

// ── ThreeCliRenderer + FrameBufferRenderable ────────────────────────────────

let engine: any = null
let fb: any = null
let ready = false

// FrameBufferRenderable — will display 3D content
const fbR = new Core.FrameBufferRenderable(renderer, {
  id: "cube-fb",
  width: tw,
  height: th,
  zIndex: 10,
  position: "absolute",
  left: 0,
  top: 0,
  respectAlpha: true,
})
fb = fbR
log("FrameBufferRenderable created")

// ThreeCliRenderer — renders Three.js scene into the framebuffer
try {
  const mod = await import("@opentui/three")
  engine = new mod.ThreeCliRenderer(renderer, { width: tw, height: th, autoResize: false })
  log("ThreeCliRenderer constructor OK")
  await engine.init()
  engine.setActiveCamera(camera)
  ready = true
  log("ThreeCliRenderer init OK — WebGPU ready, camera set")
} catch (err) {
  log("ThreeCliRenderer setup FAILED")
  logError(err)
}

// ── Layout ──────────────────────────────────────────────────────────────────

const bg = new Core.BoxRenderable(renderer, {
  id: "bg",
  width: tw, height: th,
  position: "absolute", left: 0, top: 0,
  backgroundColor: "#0a0a1a",
  borderStyle: "single",
  title: " 3D Rotating Cube ",
  titleAlignment: "center",
})
renderer.root.add(bg)
renderer.root.add(fbR)

const statusT = new Core.TextRenderable(renderer, {
  id: "status",
  content: ready ? " ↑↓←→ speed | Space: FX | Q: exit " : " engine failed — Q: exit ",
  position: "absolute",
  left: Math.max(2, Math.floor(tw / 2) - 25),
  top: th - 2,
  fg: "#888899",
  zIndex: 20,
})
renderer.root.add(statusT)

// ── Main loop: animate + render ─────────────────────────────────────────────

let speedX = 0.01, speedY = 0.02, scanlines = false, frame = 0

const timer = setInterval(async () => {
  frame++

  cube.rotation.x += speedX
  cube.rotation.y += speedY
  const t = performance.now() * 0.001
  pl.position.x = Math.sin(t * 0.8) * 3
  pl.position.z = Math.cos(t * 0.8) * 3

  if (ready && engine && fb) {
    try {
      await engine.drawScene(scene, fb.frameBuffer, 0.033)
      if (frame <= 3) log(`Frame #${frame}: drawScene OK`)
    } catch (err) {
      if (frame <= 3) { log(`Frame #${frame}: drawScene FAILED`); logError(err) }
    }
  } else if (frame <= 3) {
    log(`Frame #${frame}: skip (ready=${ready} engine=${!!engine} fb=${!!fb})`)
  }

  if (scanlines && fb) {
    try { const fx = (Core as any).applyScanlines; if (typeof fx === "function") fx(fb.frameBuffer, 0.8) } catch {}
  }
}, 33)

// ── Keyboard ────────────────────────────────────────────────────────────────

renderer.keyInput.on("keypress", (key: Core.KeyEvent) => {
  log(`Key: "${key.name}"`)
  switch (key.name) {
    case "up":    speedX = Math.min(speedX + 0.01, 0.5); break
    case "down":  speedX = Math.max(speedX - 0.01, -0.5); break
    case "left":  speedY = Math.max(speedY - 0.01, -0.5); break
    case "right": speedY = Math.min(speedY + 0.01, 0.5); break
    case "space": scanlines = !scanlines; break
    case "q":
    case "escape": log("Quit"); clearInterval(timer); flush(); try { renderer.stop() } catch {}; process.exit(0)
  }
})

// ── Timeout ─────────────────────────────────────────────────────────────────

setTimeout(() => { log(`Timeout — ${frame} frames`); clearInterval(timer); flush(); try { renderer.stop() } catch {}; process.exit(0) }, 30000)

flush()
log("Live. 30s timeout.")
