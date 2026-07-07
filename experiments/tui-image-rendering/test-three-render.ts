/**
 * Standalone test: render dragon.jpg as 3D textured plane via @opentui/core/3d
 *
 * Usage: bun run experiments/tui-image-rendering/test-three-render.ts
 *
 * Pipeline:
 *   dragon.jpg → TextureUtils.loadTextureFromFile → Three.js texture
 *   → PlaneGeometry → MeshBasicMaterial → PerspectiveCamera
 *   → ThreeCliRenderer(WebGPU) → stdout
 */
import * as THREE from "three"

async function main() {
  const opentui3d = await import("@opentui/core/3d")
  const { TextureUtils, ThreeCliRenderer, SuperSampleType } = opentui3d

  const imagePath = new URL("../vision/dragon.jpg", import.meta.url).pathname
    .replace(/^\/([A-Z]:\/)/, "$1")

  console.error("=== Loading texture ===\n  file:", imagePath)

  // Step 1: Load texture
  const texture = await TextureUtils.loadTextureFromFile(imagePath)
  if (!texture) {
    console.error("FAILED: loadTextureFromFile returned null")
    process.exit(1)
  }
  console.error("  size:", texture.image.width, "x", texture.image.height)

  // Step 2: Build scene
  const termW = 80
  const termH = 40
  const aspect = texture.image.height > 0 ? texture.image.width / texture.image.height : 1
  const planeW = termW * 0.8
  const planeH = planeW / aspect

  const geometry = new THREE.PlaneGeometry(planeW, planeH)
  const material = new THREE.MeshBasicMaterial({ map: texture })
  const mesh = new THREE.Mesh(geometry, material)

  const scene = new THREE.Scene()
  scene.add(mesh)

  // Step 3: Camera
  const camera = new THREE.PerspectiveCamera(45, planeW / Math.max(planeH, 1), 0.1, 1000)
  camera.position.z = planeH / (2 * Math.tan((45 * Math.PI) / 360))
  camera.lookAt(0, 0, 0)

  // Step 4: Renderer
  const renderW = Math.floor(planeW * 4)  // 4x super-sample
  const renderH = Math.floor(planeH * 4)

  console.error("=== Rendering ===")
  console.error("  plane:", planeW.toFixed(0), "x", planeH.toFixed(0))
  console.error("  buffer:", renderW, "x", renderH)
  console.error("  super-sample: GPU 4x")

  const renderer = new ThreeCliRenderer({
    width: renderW,
    height: renderH,
    superSample: SuperSampleType.GPU,
    alpha: false,
    autoResize: false,
  })

  renderer.render(scene, camera)
  console.error("=== Done ===")
  console.error("Check the terminal for rendered output.")
}

main().catch((err) => {
  console.error("FATAL:", err)
  process.exit(1)
})
