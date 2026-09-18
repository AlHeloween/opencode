import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import sharp from "sharp"
import { ImageHandler } from "../../src/attachment/handlers/image"

// Minimal valid 1x1 PNG (smallest possible)
function makePngBuffer(width: number = 1, height: number = 1): Buffer {
  // Minimal PNG: signature + IHDR + IDAT + IEND
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  // IHDR chunk
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(width, 0)
  ihdrData.writeUInt32BE(height, 4)
  ihdrData.writeUInt8(8, 8)  // bit depth
  ihdrData.writeUInt8(2, 9)  // color type (RGB)
  ihdrData.writeUInt8(0, 10) // compression
  ihdrData.writeUInt8(0, 11) // filter
  ihdrData.writeUInt8(0, 12) // interlace

  const ihdr = makeChunk("IHDR", ihdrData)

  // IDAT chunk (minimal compressed data for 1x1 RGB pixel)
  const idat = makeChunk("IDAT", Buffer.from([120, 156, 98, 96, 96, 0, 0, 0, 1, 0, 1]))

  // IEND chunk
  const iend = makeChunk("IEND", Buffer.alloc(0))

  return Buffer.concat([signature, ihdr, idat, iend])
}

function makeChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type)

  // CRC32 (simplified — using zeros for test purposes)
  const crc = Buffer.alloc(4)
  const crcInput = Buffer.concat([typeBuf, data])
  let c = 0xffffffff
  for (let i = 0; i < crcInput.length; i++) {
    c ^= crcInput[i]
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0)
  }
  crc.writeUInt32BE((c ^ 0xffffffff) >>> 0, 0)

  return Buffer.concat([len, typeBuf, data, crc])
}

function makeDataUrl(buf: Buffer, mime: string): string {
  return `data:${mime};base64,${buf.toString("base64")}`
}

/** A real, decodable image — the synthetic PNG above has no valid pixel data. */
async function makeRealImage(width: number, height: number, format: "png" | "jpeg" = "png"): Promise<Buffer> {
  const image = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } })
  return format === "png" ? image.png().toBuffer() : image.jpeg().toBuffer()
}

describe("ImageHandler", () => {
  test("detect returns true for image/ mime types", () => {
    expect(ImageHandler.detect("image/png")).toBe(true)
    expect(ImageHandler.detect("image/jpeg")).toBe(true)
    expect(ImageHandler.detect("image/webp")).toBe(true)
    expect(ImageHandler.detect("image/gif")).toBe(true)
    expect(ImageHandler.detect("image/svg+xml")).toBe(false) // excludes SVG
    expect(ImageHandler.detect("video/mp4")).toBe(false)
  })

  test("classify extracts dimensions from PNG data URL", async () => {
    const png = makePngBuffer(64, 48)
    const url = makeDataUrl(png, "image/png")
    const att = { type: "file", kind: "image", mime: "image/png", url, filename: "test.png" } as any

    const result = await Effect.runPromise(ImageHandler.classify(att).pipe(Effect.orDie))

    expect(result.kind).toBe("image")
    const meta = result.metadata as any
    expect(meta).toBeDefined()
    expect(meta._tag).toBe("image")
    expect(meta.width).toBe(64)
    expect(meta.height).toBe(48)
  })

  test("classify handles non-data URL", async () => {
    const att = { type: "file", kind: "image", mime: "image/png", url: "https://example.com/img.png" } as any
    const result = await Effect.runPromise(ImageHandler.classify(att).pipe(Effect.orDie))

    expect(result.kind).toBe("image")
    expect((result.metadata as any).width).toBe(0)
    expect((result.metadata as any).height).toBe(0)
  })

  test("normalize converts to webp (quality 80, effort 6) without upscaling", async () => {
    const small = await makeRealImage(10, 10)
    const url = makeDataUrl(small, "image/png")
    const att: any = {
      type: "file", kind: "image", mime: "image/png", url, filename: "small.png",
    }

    const result = await Effect.runPromise(
      (ImageHandler as any).normalize(att, { image: { max_width: 2000, max_height: 2000 } }).pipe(Effect.orDie),
    ) as any

    expect(result.mime).toBe("image/webp")
    expect(result.url.startsWith("data:image/webp;base64,")).toBe(true)
    const out = Buffer.from(result.url.split(",")[1], "base64")
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe("webp")
    expect(meta.width).toBe(10)
    expect(meta.height).toBe(10)
  })

  test("normalize caps dimensions (jpeg input) and still yields webp", async () => {
    const big = await makeRealImage(4000, 3000, "jpeg")
    const url = makeDataUrl(big, "image/jpeg")
    const att: any = {
      type: "file", kind: "image", mime: "image/jpeg", url, filename: "big.jpg",
    }

    const result = await Effect.runPromise(
      (ImageHandler as any).normalize(att, { image: { max_width: 200, max_height: 200 } }).pipe(Effect.orDie),
    ) as any

    expect(result.mime).toBe("image/webp")
    const out = Buffer.from(result.url.split(",")[1], "base64")
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe("webp")
    expect(meta.width).toBeLessThanOrEqual(200)
    expect(meta.height).toBeLessThanOrEqual(200)
  })

  test("normalize keeps the original when the input cannot be decoded", async () => {
    const junk = Buffer.from("this is not an image")
    const url = makeDataUrl(junk, "image/png")
    const att: any = {
      type: "file", kind: "image", mime: "image/png", url, filename: "junk.png",
    }

    const result = await Effect.runPromise(
      (ImageHandler as any).normalize(att, {}).pipe(Effect.orDie),
    ) as any

    expect(result.url).toBe(url)
    expect(result.mime).toBe("image/png")
  })

  test("describe formats image info", () => {
    const att: any = {
      kind: "image", mime: "image/png", filename: "photo.png",
      metadata: { _tag: "image", width: 1920, height: 1080 },
    }
    const desc = ImageHandler.describe(att)
    expect(desc).toContain("photo.png")
    expect(desc).toContain("1920")
    expect(desc).toContain("1080")
  })

  test("render returns TUI badge", () => {
    const att: any = {
      kind: "image", mime: "image/jpeg", filename: "pic.jpg",
      metadata: { _tag: "image", width: 800, height: 600 },
    }
    const rendered = ImageHandler.render(att)
    expect(rendered.badge.text).toBe("img")
    expect(rendered.label).toBe("pic.jpg")
    expect(rendered.preview).toBe("800×600")
  })

  // ── Dimensions are the window budget's only legal price for an image ────────
  //
  // The image is decoded here anyway, so the dimensions it comes out with cost
  // nothing extra and are stamped onto the stored part (2026-09-18). Payload
  // BYTES are never the price: counting a base64 blob as text produced ~688K
  // phantom tokens on a single video and an emergency compaction that silently
  // dropped it (2026-09-07). These cases pin the OUTPUT dimensions — the ones
  // that actually go on the wire after the cap — not the input's.

  test("normalize reports the capped output dimensions it produced", async () => {
    const big = await makeRealImage(4000, 3000)
    const att: any = {
      type: "file", kind: "image", mime: "image/png",
      url: makeDataUrl(big, "image/png"), filename: "big.png",
    }

    const result = await Effect.runPromise(
      (ImageHandler as any).normalize(att, { image: { max_width: 2000, max_height: 2000 } }).pipe(Effect.orDie),
    ) as any

    expect(result.mime).toBe("image/webp")
    expect(result.metadata).toBeDefined()
    expect(result.metadata._tag).toBe("image")
    // 4000×3000 fit inside 2000×2000 → 2000×1500, so the price follows the wire,
    // not the original file.
    expect(result.metadata.width).toBe(2000)
    expect(result.metadata.height).toBe(1500)

    // The reported dimensions must match the bytes actually emitted.
    const out = Buffer.from(result.url.split(",")[1], "base64")
    const meta = await sharp(out).metadata()
    expect(result.metadata.width).toBe(meta.width)
    expect(result.metadata.height).toBe(meta.height)
  })

  test("normalize records no dimensions when it could not decode", async () => {
    const url = makeDataUrl(Buffer.from("this is not an image"), "image/png")
    const att: any = { type: "file", kind: "image", mime: "image/png", url, filename: "junk.png" }

    const result = await Effect.runPromise(
      (ImageHandler as any).normalize(att, {}).pipe(Effect.orDie),
    ) as any

    // Original bytes survive, and an unknown size must stay unknown rather than
    // become a fabricated number — the same reason media is 0 without a
    // measurement rather than an invented heuristic.
    expect(result.url).toBe(url)
    expect(result.metadata).toBeUndefined()
  })
})
