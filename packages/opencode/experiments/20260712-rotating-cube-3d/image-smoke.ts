/**
 * Image smoke test — renders a checkerboard PNG to the terminal.
 *
 * The simplest possible rendering test: generate a PNG in memory, write it to
 * a temp file, load it via @opentui/three's TextureUtils, render it as a
 * textured plane via ThreeCliRenderer → FrameBufferRenderable.
 *
 * Run: cd packages/opencode && bun run experiments/20260712-rotating-cube-3d/image-smoke.ts
 */

import * as Core from "@opentui/core"
import { join } from "path"
import { appendFileSync, writeFileSync, unlinkSync } from "fs"
import { tmpdir } from "os"

// ── Logger ──────────────────────────────────────────────────────────────────

const LOG_FILE = join(import.meta.dir, "image-smoke.log")
const BUF: string[] = []
function log(m: string) { const l = `[${new Date().toISOString()}] ${m}\n`; process.stderr.write(l); BUF.push(l) }
function logError(err: unknown) {
  if (err instanceof Error) log(`  ${err.name}: ${err.message}`)
  else log(`  ${String(err)}`)
}
function flush() { try { appendFileSync(LOG_FILE, BUF.join(""), "utf-8") } catch {} }

// ── Minimal PNG generator (64×64 checkerboard) ──────────────────────────────

function makePng(size: number): string {
  const check = 8; const p: number[] = []
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = (Math.floor(x / check) + Math.floor(y / check)) % 2 === 0
    if (c) p.push(0x3b, 0x82, 0xf6, 255); else p.push(0x1e, 0x40, 0x73, 255)
  }
  const raw = new Uint8Array(p.length + 128); let o = 0
  const u8 = (v: number) => raw[o++] = v & 0xff
  const u32 = (v: number) => { raw[o++] = (v >> 24) & 0xff; raw[o++] = (v >> 16) & 0xff; raw[o++] = (v >> 8) & 0xff; raw[o++] = v & 0xff }
  const crc = (d: Uint8Array, s: number, n: number) => { let c = 0xffffffff; for (let i = s; i < s + n; i++) { c ^= d[i]; for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0) } return (c ^ 0xffffffff) >>> 0 }
  const chk = (t: string, d: Uint8Array) => { const h = new Uint8Array(4); h[0] = t.charCodeAt(0); h[1] = t.charCodeAt(1); h[2] = t.charCodeAt(2); h[3] = t.charCodeAt(3); u32(d.length); raw.set(h, o); o += 4; raw.set(d, o); o += d.length; const c = crc(h, 0, 4) ^ crc(d, 0, d.length) >>> 0; u32(c) }
  raw.set([137, 80, 78, 71, 13, 10, 26, 10], 0); o = 8
  const ihdr = new Uint8Array(13); let di = 0
  ihdr[di++] = size >> 24; ihdr[di++] = size >> 16; ihdr[di++] = size >> 8; ihdr[di++] = size
  ihdr[di++] = size >> 24; ihdr[di++] = size >> 16; ihdr[di++] = size >> 8; ihdr[di++] = size
  ihdr[di++] = 8; ihdr[di++] = 6; ihdr[di++] = 0; ihdr[di++] = 0; ihdr[di++] = 0
  chk("IHDR", ihdr)
  const px = new Uint8Array(1 + size * size * 4); di = 0
  for (let y = 0; y < size; y++) { px[di++] = 0; for (let x = 0; x < size; x++) { const i = (y * size + x) * 4; px[di++] = p[i]; px[di++] = p[i + 1]; px[di++] = p[i + 2]; px[di++] = p[i + 3] } }
  chk("IDAT", px)
  chk("IEND", new Uint8Array(0))
  const final = raw.slice(0, o)
  return `data:image/png;base64,${btoa(String.fromCharCode(...final))}`
}

// ── Main ────────────────────────────────────────────────────────────────────

log(`Log: ${LOG_FILE}`)
log(`Bun ${Bun.version} on ${process.platform} ${process.arch}`)

const renderer = await Core.createCliRenderer({ targetFps: 15, exitOnCtrlC: true })
renderer.setBackgroundColor("#0a0a1a")
renderer.start()
const tw = renderer.terminalWidth
const th = renderer.terminalHeight
log(`Terminal: ${tw}×${th}`)

// Generate PNG
const pngDataUrl = makePng(64)
log(`Generated PNG: ${pngDataUrl.length} bytes`)

// Write to temp file (TextureUtils.loadTextureFromFile requires a file path)
const tmpFile = join(tmpdir(), `opencode_smoke_${Date.now()}.png`)
writeFileSync(tmpFile, Buffer.from(pngDataUrl.split(",")[1]!, "base64"))
log(`Temp file: ${tmpFile}`)

// Three.js scene with textured plane
const THREE = await import("three") as any
const opentui3d = await import("@opentui/three") as any

const tex = await opentui3d.TextureUtils.loadTextureFromFile(tmpFile)
if (!tex) { log("TextureUtils returned null"); process.exit(1) }
log(`Texture: ${tex.image.width}×${tex.image.height}`)

const scene = new THREE.Scene()
const geo = new THREE.PlaneGeometry(32, 32)
const mat = new THREE.MeshBasicMaterial({ map: tex })
const mesh = new THREE.Mesh(geo, mat)
scene.add(mesh)

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
camera.position.z = 25

// FrameBufferRenderable
const fbR = new Core.FrameBufferRenderable(renderer, {
  id: "img-fb",
  width: tw, height: th,
  position: "absolute", left: 0, top: 0,
  zIndex: 10, respectAlpha: true,
})

// ThreeCliRenderer
const engine = new opentui3d.ThreeCliRenderer(renderer, { width: tw, height: th, autoResize: false })
await engine.init()
engine.setActiveCamera(camera)
log("ThreeCliRenderer ready")

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

// Render a single frame, then enter idle loop
const buffer = fbR.frameBuffer
await engine.drawScene(scene, buffer, 0.016)
log("drawScene: OK — checkerboard rendered to framebuffer")

// Clean up temp file
try { unlinkSync(tmpFile) } catch {}

// Idle until quit
renderer.keyInput.on("keypress", (key: Core.KeyEvent) => {
  if (key.name === "q" || key.name === "escape") {
    log("Quit"); flush(); try { renderer.stop() } catch {}; process.exit(0)
  }
})

setTimeout(() => { log("Timeout"); flush(); try { renderer.stop() } catch {}; process.exit(0) }, 30000)
flush()
log("Image rendered. 30s timeout.")
