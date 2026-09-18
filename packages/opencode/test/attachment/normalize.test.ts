import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import sharp from "sharp"
import { normalizeAttachment } from "../../src/attachment/normalize"

/** A real, decodable image — synthetic PNGs carry no valid pixel data. */
async function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 220 } } })
    .png()
    .toBuffer()
}

describe("normalizeAttachment", () => {
  test("registers handlers and converts an image part to webp", async () => {
    const png = await makePng(12, 12)
    const part = {
      type: "file" as const,
      mime: "image/png",
      url: `data:image/png;base64,${png.toString("base64")}`,
      filename: "paste.png",
    }

    const out = await Effect.runPromise(normalizeAttachment(part).pipe(Effect.orDie))

    expect(out.mime).toBe("image/webp")
    expect(out.url.startsWith("data:image/webp;base64,")).toBe(true)
    expect(out.filename).toBe("paste.png")
    expect(out.type).toBe("file")
    expect("kind" in out).toBe(false) // handler-only field never leaks into the part
    const meta = await sharp(Buffer.from(out.url.split(",")[1], "base64")).metadata()
    expect(meta.format).toBe("webp")
    expect(meta.width).toBe(12)
    expect(meta.height).toBe(12)
  })

  test("passes non-image values through untouched", async () => {
    const part = {
      type: "file" as const,
      mime: "text/plain",
      url: "data:text/plain;base64,aGk=",
      filename: "note.txt",
    }

    const out = await Effect.runPromise(normalizeAttachment(part).pipe(Effect.orDie))

    expect(out).toBe(part)
  })

  test("passes svg through untouched (image_vector has no normalizer)", async () => {
    const part = {
      type: "file" as const,
      mime: "image/svg+xml",
      url: `data:image/svg+xml;base64,${Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64")}`,
    }

    const out = await Effect.runPromise(normalizeAttachment(part).pipe(Effect.orDie))

    expect(out).toBe(part)
  })

  test("keeps the original bytes when the image cannot be decoded", async () => {
    const part = {
      type: "file" as const,
      mime: "image/png",
      url: `data:image/png;base64,${Buffer.from("not an image").toString("base64")}`,
    }

    const out = await Effect.runPromise(normalizeAttachment(part).pipe(Effect.orDie))

    expect(out).toBe(part)
  })
})
