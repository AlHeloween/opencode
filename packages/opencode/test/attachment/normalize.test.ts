import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import sharp from "sharp"
import { normalizeAttachment, filePartFromNormalized } from "../../src/attachment/normalize"

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

  test("lifts the produced dimensions onto the part the budget will price", async () => {
    // THIS is the seam where the dimensions used to be lost: the handler decodes
    // the image and knows the size it produced, but the value was rebuilt as
    // `{ ...value, mime, url }`, so everything else the handler learned was
    // dropped on the way to the stored part. The window budget prices an image
    // from `MessageV2.FilePart.dimensions` (`overflow.estimateMediaTokens`), so
    // this seam decides whether an image is visible to the Layer-1 cadence and
    // the Layer-2 fold at all. Bytes can never be the price: counting a base64
    // blob as text produced ~688K phantom tokens and silently dropped a video
    // (measured 2026-09-07).
    const png = await makePng(4000, 3000)
    const part = {
      type: "file" as const,
      mime: "image/png",
      url: `data:image/png;base64,${png.toString("base64")}`,
      filename: "big.png",
    }

    const out: any = await Effect.runPromise(
      normalizeAttachment(part, { image: { max_width: 2000, max_height: 2000 } }).pipe(Effect.orDie),
    )

    // 4000×3000 inside 2000×2000 ⇒ 2000×1500 — the size that goes ON THE WIRE,
    // not the size of the file the user pasted.
    expect(out.dimensions).toEqual({ width: 2000, height: 1500 })
    // The lift ADDS; it never replaces. The part keeps its identity otherwise.
    expect(out.type).toBe("file")
    expect(out.filename).toBe("big.png")
    expect(out.mime).toBe("image/webp")
    expect("kind" in out).toBe(false)
  })
})

/**
 * The stored part is built in ONE place, because building it by hand is how a
 * field gets lost. Tool media (`processor.ts` tool-result path) and
 * provider-generated images each rebuilt the part field-by-field, so when
 * `normalize` started reporting `dimensions` neither carried them — the video
 * frames `read.ts` samples arrive as `image/jpeg` parts and were priced at 0
 * (2026-09-18). These cases pin the constructor, not the call sites.
 */
describe("filePartFromNormalized", () => {
  test("carries every field a handler reported, dimensions included", () => {
    const part = filePartFromNormalized(
      {
        mime: "image/webp",
        url: "data:image/webp;base64,AAAA",
        filename: "shot.webp",
        dimensions: { width: 1280, height: 720 },
      },
      { messageID: "msg-1", sessionID: "ses-1" },
    )

    // The regression this exists for: without this line the price is 0 and the
    // image is invisible to both compaction thresholds.
    expect(part.dimensions).toEqual({ width: 1280, height: 720 })
    expect(part.type).toBe("file")
    expect(part.mime).toBe("image/webp")
    expect(part.filename).toBe("shot.webp")
    expect(part.messageID).toBe("msg-1")
    expect(part.sessionID).toBe("ses-1")
  })

  test("omits absent fields rather than writing undefined into the part", () => {
    const part = filePartFromNormalized(
      { mime: "application/pdf", url: "data:application/pdf;base64,AAAA" },
      { messageID: "m", sessionID: "s" },
    )

    // A part with `filename: undefined` still serialises a key; an unexpected
    // size must stay ABSENT, the same reason an unmeasured image prices at 0
    // rather than at a fabricated number.
    expect("filename" in part).toBe(false)
    expect("dimensions" in part).toBe(false)
  })
})
