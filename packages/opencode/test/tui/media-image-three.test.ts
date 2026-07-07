/**
 * Test suite: @opentui/core/3d pipeline for image rendering
 * ============================================================================
 * Validates the 3D rendering path for images-as-textures-on-planes.
 * This is the foundation for future 3D GUI themes.
 *
 * What CAN be tested standalone (no CliRenderer needed):
 *   1. TextureUtils — load, dimensions, format handling
 *   2. TextureUtils procedural — checkerboard, gradient, noise
 *   3. Three.js geometry — PlaneGeometry, Mesh, Scene, Camera math
 *   4. API surface — all exports present, types match
 *
 * What REQUIRES CliRenderer (not testable without full terminal context):
 *   - ThreeCliRenderer construction and rendering
 *   - ThreeRenderable integration into OpenTUI render tree
 *   - CLICanvas readback to OptimizedBuffer
 *   - SuperSample pipeline
 */
import { describe, expect, test } from "bun:test"
import * as THREE from "three"

// ---------------------------------------------------------------------------
// API surface — verify all expected exports exist
// ---------------------------------------------------------------------------

describe("@opentui/core/3d API surface", () => {
  test("exports ThreeRenderable", async () => {
    const m = await import("@opentui/core/3d")
    expect(m.ThreeRenderable).toBeDefined()
    expect(typeof m.ThreeRenderable).toBe("function")
  })

  test("exports ThreeCliRenderer", async () => {
    const m = await import("@opentui/core/3d")
    expect(m.ThreeCliRenderer).toBeDefined()
    expect(typeof m.ThreeCliRenderer).toBe("function")
  })

  test("exports CLICanvas", async () => {
    const m = await import("@opentui/core/3d")
    expect(m.CLICanvas).toBeDefined()
  })

  test("exports TextureUtils", async () => {
    const m = await import("@opentui/core/3d")
    expect(m.TextureUtils).toBeDefined()
    expect(typeof m.TextureUtils.loadTextureFromFile).toBe("function")
    expect(typeof m.TextureUtils.createCheckerboard).toBe("function")
    expect(typeof m.TextureUtils.createGradient).toBe("function")
    expect(typeof m.TextureUtils.createNoise).toBe("function")
  })

  test("exports SuperSampleType enum", async () => {
    const m = await import("@opentui/core/3d")
    expect(m.SuperSampleType).toBeDefined()
    expect(m.SuperSampleType.NONE).toBeDefined()
    expect(m.SuperSampleType.GPU).toBeDefined()
    expect(m.SuperSampleType.CPU).toBeDefined()
  })

  test("exports SpriteUtils and animation classes", async () => {
    const m = await import("@opentui/core/3d")
    expect(m.SpriteUtils).toBeDefined()
    expect(m.SpriteAnimator).toBeDefined()
    expect(m.TiledSprite).toBeDefined()
    expect(m.SpriteResourceManager).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// TextureUtils — image loading and procedural textures
// ---------------------------------------------------------------------------

describe("TextureUtils", () => {
  test("loadTextureFromFile loads dragon.jpg with correct dimensions", async () => {
    const { TextureUtils } = await import("@opentui/core/3d")
    const texture = await TextureUtils.loadTextureFromFile(
      "D:/zPython/opencode/experiments/vision/dragon.jpg",
    )
    expect(texture).not.toBeNull()
    expect(texture!.image).toBeDefined()
    expect(texture!.image.width).toBe(492)
    expect(texture!.image.height).toBe(960)
  })

  test("loadTextureFromFile loads smaller test.png", async () => {
    const { TextureUtils } = await import("@opentui/core/3d")
    const texture = await TextureUtils.loadTextureFromFile(
      "D:/zPython/opencode/experiments/vision/test.png",
    )
    expect(texture).not.toBeNull()
    expect(texture!.image.width).toBeGreaterThan(0)
    expect(texture!.image.height).toBeGreaterThan(0)
  })

  test("loadTextureFromFile returns null for non-existent file", async () => {
    const { TextureUtils } = await import("@opentui/core/3d")
    const texture = await TextureUtils.loadTextureFromFile(
      "D:/zPython/opencode/experiments/vision/does_not_exist.jpg",
    )
    expect(texture).toBeNull()
  })

  test("createCheckerboard produces valid texture", async () => {
    const { TextureUtils } = await import("@opentui/core/3d")
    const texture = TextureUtils.createCheckerboard(256)
    expect(texture).toBeDefined()
    const img = texture.image as { width: number; height: number }
    expect(img.width).toBe(256)
    expect(img.height).toBe(256)
  })

  test("createGradient produces valid texture", async () => {
    const { TextureUtils } = await import("@opentui/core/3d")
    const texture = TextureUtils.createGradient(128)
    expect(texture).toBeDefined()
    const img = texture.image as { width: number; height: number }
    expect(img.width).toBe(128)
    expect(img.height).toBe(128)
  })

  test("createNoise produces valid texture", async () => {
    const { TextureUtils } = await import("@opentui/core/3d")
    const texture = TextureUtils.createNoise(128)
    expect(texture).toBeDefined()
    const img = texture.image as { width: number; height: number }
    expect(img.width).toBe(128)
    expect(img.height).toBe(128)
  })
})

// ---------------------------------------------------------------------------
// Three.js geometry — plane with texture, aspect ratio math
// ---------------------------------------------------------------------------

describe("Three.js geometry for image rendering", () => {
  test("PlaneGeometry sizing preserves aspect ratio", () => {
    // dragon.jpg: 492×960 → aspect = 0.5125
    const texW = 492
    const texH = 960
    const aspect = texW / texH

    const cols = 80
    const pw = cols * 0.75
    const ph = pw / aspect

    expect(pw).toBeCloseTo(60)
    expect(ph).toBeCloseTo(117.07, 0)
    expect(pw / ph).toBeCloseTo(aspect, 2)
  })

  test("PlaneGeometry creation does not throw", () => {
    const geometry = new THREE.PlaneGeometry(64, 125)
    expect(geometry).toBeDefined()
    expect(geometry.attributes.position.count).toBe(4) // 4 vertices
  })

  test("PerspectiveCamera FOV math is correct", () => {
    // For a plane of height H, camera distance = H / (2 * tan(FOV/2))
    const fov = 45
    const planeH = 125
    const expectedZ = planeH / (2 * Math.tan((fov * Math.PI) / 360))
    expect(expectedZ).toBeCloseTo(150.88, 1)
  })

  test("TextureData → Mesh pipeline doesn't throw", async () => {
    const { TextureUtils } = await import("@opentui/core/3d")
    const texture = await TextureUtils.loadTextureFromFile(
      "D:/zPython/opencode/experiments/vision/dragon.jpg",
    )
    expect(texture).not.toBeNull()

    const aspect = texture!.image.height > 0
      ? texture!.image.width / texture!.image.height
      : 1
    const pw = 64
    const ph = pw / aspect

    const geometry = new THREE.PlaneGeometry(pw, ph)
    const material = new THREE.MeshBasicMaterial({ map: texture })
    const mesh = new THREE.Mesh(geometry, material)
    const scene = new THREE.Scene()
    scene.add(mesh)

    expect(scene.children.length).toBe(1)
    expect(mesh.material.map).toBe(texture)
  })

  test("checkerboard texture on plane", () => {
    const { TextureUtils } = require("@opentui/core/3d")
    // Note: createCheckerboard is synchronous (procedural)
    const texture = TextureUtils.createCheckerboard(256, "#ff0000", "#00ff00", 32)
    const geometry = new THREE.PlaneGeometry(80, 40)
    const material = new THREE.MeshBasicMaterial({ map: texture })
    const mesh = new THREE.Mesh(geometry, material)

    expect(mesh).toBeDefined()
    expect(mesh.material.map).toBe(texture)
  })
})

// ---------------------------------------------------------------------------
// CliRenderer dependency analysis — what requires it
// ---------------------------------------------------------------------------

describe("CliRenderer dependency analysis", () => {
  test("ThreeCliRenderer constructor requires CliRenderer", async () => {
    // This confirms: ThreeCliRenderer CANNOT be used standalone.
    // It must be constructed within the OpenTUI render tree where
    // a CliRenderer instance is available (via useRenderer()).
    const { ThreeCliRenderer } = await import("@opentui/core/3d")

    // Constructor signature: (cliRenderer: CliRenderer, options)
    // Attempting to construct without CliRenderer should throw
    expect(() => {
      // @ts-expect-error CliRenderer is required
      new ThreeCliRenderer({ width: 256, height: 256 })
    }).toThrow()
  })

  test("TextureUtils does NOT require CliRenderer", async () => {
    // TextureUtils is fully standalone — uses sharp internally,
    // returns standard Three.js Texture objects.
    const { TextureUtils } = await import("@opentui/core/3d")
    const texture = await TextureUtils.loadTextureFromFile(
      "D:/zPython/opencode/experiments/vision/dragon.jpg",
    )
    expect(texture).not.toBeNull()
    expect(texture!.isTexture).toBe(true)
  })

  test("Procedural textures are fully standalone", async () => {
    const { TextureUtils } = await import("@opentui/core/3d")
    // All procedural methods work without any terminal context
    const checker = TextureUtils.createCheckerboard(64)
    const gradient = TextureUtils.createGradient(64)
    const noise = TextureUtils.createNoise(64)

    expect(checker).toBeDefined()
    expect(gradient).toBeDefined()
    expect(noise).toBeDefined()
  })
})
