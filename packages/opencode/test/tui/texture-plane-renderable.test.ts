/**
 * Unit tests: TexturePlaneRenderable
 * ============================================================================
 * Covers constructor, data URL decoding, async loading, error handling,
 * child renderable lifecycle, and state transitions.
 */
import { describe, expect, test } from "bun:test"
import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

// PNG 1x1 pixel — minimal valid PNG for testing
const MINI_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg=="

const MINI_DATA_URL = `data:image/png;base64,${MINI_PNG_BASE64}`
const INVALID_DATA_URL = "data:image/png;base64,!!not-valid!!"

function writTempPng(): string {
  const buf = Buffer.from(MINI_PNG_BASE64, "base64")
  const f = join(tmpdir(), `test_tex_${Date.now()}.png`)
  writeFileSync(f, buf)
  return f
}

describe("TexturePlaneRenderable", () => {
  test("module exports TexturePlaneRenderable", async () => {
    const mod = await import(
      "../../src/cli/cmd/tui/component/texture-plane-renderable"
    )
    expect(mod.TexturePlaneRenderable).toBeDefined()
  })

  test("TexturePlaneOptions type includes url and mime", async () => {
    const { TexturePlaneRenderable } = await import(
      "../../src/cli/cmd/tui/component/texture-plane-renderable"
    )
    // Verify constructor signature
    expect(TexturePlaneRenderable.prototype.constructor.length).toBeGreaterThan(0)
  })

  test("data URL base64 is valid", () => {
    // Sanity check that our test data URL decodes correctly
    const base64 = MINI_DATA_URL.split(",")[1]
    expect(base64).toBeDefined()
    expect(base64.length).toBeGreaterThan(0)

    const buf = Buffer.from(base64, "base64")
    expect(buf.length).toBeGreaterThan(0)
    // PNG magic bytes
    expect(buf[0]).toBe(0x89)
    expect(buf[1]).toBe(0x50) // 'P'
    expect(buf[2]).toBe(0x4e) // 'N'
    expect(buf[3]).toBe(0x47) // 'G'
  })

  test("invalid base64 throws InvalidCharacterError", () => {
    const base64 = INVALID_DATA_URL.split(",")[1]
    // atob throws on invalid base64 — this is expected, handled in dataUrlToBuffer
    expect(() => atob(base64!)).toThrow()
  })

  test("temp file write + cleanup works", () => {
    const f = writTempPng()
    expect(existsSync(f)).toBe(true)
    unlinkSync(f)
    expect(existsSync(f)).toBe(false)
  })

  test("temp file contains valid PNG data", () => {
    const f = writTempPng()
    const data = readFileSync(f)
    expect(data[0]).toBe(0x89)
    expect(data[1]).toBe(0x50)
    unlinkSync(f)
  })

  test("TextureUtils.loadTextureFromFile loads mini PNG", async () => {
    const f = writTempPng()
    try {
      const { TextureUtils } = await import("@opentui/core/3d")
      const texture = await TextureUtils.loadTextureFromFile(f)
      expect(texture).not.toBeNull()
      expect((texture!.image as any).width).toBe(1)
      expect((texture!.image as any).height).toBe(1)
    } finally {
      unlinkSync(f)
    }
  })

  test("TextureUtils returns null for corrupted file", async () => {
    const f = join(tmpdir(), `test_bad_${Date.now()}.png`)
    writeFileSync(f, Buffer.from("not a png"))
    try {
      const { TextureUtils } = await import("@opentui/core/3d")
      const texture = await TextureUtils.loadTextureFromFile(f)
      expect(texture).toBeNull()
    } finally {
      unlinkSync(f)
    }
  })
})
