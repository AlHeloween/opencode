/**
 * Direct ThreeRenderable smoketest with file logging.
 */
import { createCliRenderer, TextRenderable, RGBA } from "@opentui/core"
import { ThreeRenderable, TextureUtils, SuperSampleType } from "@opentui/three"
import * as THREE from "three"
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const LOG = "D:/zPython/opencode/.temp/smoketest-direct.log"
try { mkdirSync("D:/zPython/opencode/.temp", { recursive: true }) } catch {}
const log = (msg: string) => { writeFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`, { flag: "a" }) }

const IMAGE = process.argv[2] ?? "D:/zPython/opencode/experiments/vision/dragon.jpg"

async function main() {
  log(`starting: IMAGE=${IMAGE}`)

  // Force bun-webgpu to load — provides navigator.gpu in Bun
  try { await import("bun-webgpu"); log("bun-webgpu imported OK") } catch(e: any) { log(`bun-webgpu import failed: ${e.message}`) }
  log(`bun-webgpu available: ${typeof (globalThis as any).navigator?.gpu}`)

  const renderer = await createCliRenderer({ exitOnCtrlC: true, targetFps: 30 })
  log(`renderer created: ${renderer.width}x${renderer.height}`)
  log(`capabilities: ${JSON.stringify(renderer.capabilities)}`)

  renderer.keyInput.on("keypress", (key: any) => {
    if (key.name === "escape") { log("escape pressed — exiting"); renderer.destroy(); process.exit(0) }
  })

  const W = renderer.width
  const H = renderer.height

  // Load texture
  const base64 = readFileSync(IMAGE).toString("base64")
  const ext = IMAGE.endsWith(".jpg") ? ".jpg" : ".png"
  const tmpFile = join(tmpdir(), `ot3d_${Date.now()}${ext}`)
  writeFileSync(tmpFile, Buffer.from(base64, "base64"))
  log(`texture temp file: ${tmpFile} (${base64.length} chars b64)`)

  let texture: any = null
  try {
    texture = await TextureUtils.loadTextureFromFile(tmpFile)
    log(`texture loaded: ${!!texture}, ${texture?.image?.width}x${texture?.image?.height}`)
  } catch(e: any) {
    log(`texture load ERROR: ${e.message}`)
  } finally {
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile) } catch {}
  }

  if (!texture) {
    log("FATAL: texture load returned null")
    process.exit(1)
  }

  const aspect = texture.image.width / texture.image.height
  // Fit plane within terminal: use 80% of height for 3D, 20% for text
  const maxH = Math.round(H * 0.75)
  const ph = maxH
  const pw = Math.round(ph * aspect)
  log(`plane: ${pw}x${ph} (aspect=${aspect.toFixed(3)}, terminal=${W}x${H})`)

  // Build 3D scene
  const geometry = new THREE.PlaneGeometry(pw, ph)
  const material = new THREE.MeshBasicMaterial({ map: texture })
  const mesh = new THREE.Mesh(geometry, material)
  const scene = new THREE.Scene()
  scene.add(mesh)
  const camera = new THREE.PerspectiveCamera(45, pw / ph, 0.1, 1000)
  camera.position.z = ph / (2 * Math.tan((45 * Math.PI) / 360))
  log(`scene built, camera.z=${camera.position.z.toFixed(1)}`)

  try {
    const three = new ThreeRenderable(renderer, {
      width: W,
      height: H,
      scene,
      camera,
      renderer: { superSample: SuperSampleType.GPU, alpha: false },
    })
    log(`ThreeRenderable created: ${three.width}x${three.height}, id=${three.id}`)

    renderer.root.add(three)
    log("ThreeRenderable added to root")

    const text = new TextRenderable(renderer, {
      content: `3D: ${IMAGE.split("/").pop()} ${texture.image.width}x${texture.image.height} — ESC`,
      position: "absolute", left: 0, top: 0, fg: "#00FF00", zIndex: 100,
    })
    renderer.root.add(text)
    log("text overlay added")

    renderer.start()
    log("renderer.start() called — waiting for frames...")

    // Check after 500ms if renderer is alive
    setTimeout(() => {
      log(`alive check: running=${!renderer.isDestroyed}, focused=${renderer.currentFocusedRenderable?.id}`)
    }, 500)

  } catch(e: any) {
    log(`FATAL during setup: ${e.stack || e.message}`)
    process.exit(1)
  }
}

main().catch((err: any) => {
  log(`UNHANDLED: ${err.stack || err.message}`)
  process.exit(1)
})
