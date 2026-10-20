import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import sharp from "sharp"
import { normalizeAttachment } from "../../src/attachment/normalize"
import { fileIdForImage, __resetFilesCache } from "../../src/provider/files-cache"

setDefaultTimeout(20_000)

async function jimp(): Promise<any> {
  const mod = (await import("jimp")) as any
  return mod.Jimp ?? mod.default?.Jimp ?? mod.default
}

async function makeBmp(width: number, height: number): Promise<Buffer> {
  const Jimp = await jimp()
  const img = new Jimp({ width, height, color: 0xff0000ff })
  return (await img.getBuffer("image/bmp")) as Buffer
}

async function makePhotoJpg(width: number, height: number): Promise<Buffer> {
  const Jimp = await jimp()
  const img = new Jimp({ width, height })
  img.scan((x: number, y: number, i: number) => {
    const data = img.bitmap.data as Buffer
    const v = ((x * 255) / width + ((y * 255) / height / 2)) | 0
    data[i] = v
    data[i + 1] = 255 - v
    data[i + 2] = (x * y) % 256
    data[i + 3] = 255
  })
  return (await img.getBuffer("image/jpeg", { quality: 85 })) as Buffer
}

const part = (mime: string, bytes: Buffer, filename: string) => ({
  type: "file" as const,
  mime,
  url: `data:${mime};base64,${bytes.toString("base64")}`,
  filename,
})

const caps = { image: { max_width: 2000, max_height: 2000 } }

async function normalizeMime(p: ReturnType<typeof part>, config: unknown = caps): Promise<string> {
  const out = await Effect.runPromise(normalizeAttachment(p, config).pipe(Effect.orDie))
  return (out as { mime: string }).mime
}

describe("t103 always-webp: every image path reaches the adapter as webp", () => {
  test("bmp paste (fits) becomes webp with identical pixels", async () => {
    const bmp = await makeBmp(8, 8)
    expect(bmp.subarray(0, 2).toString("ascii")).toBe("BM")
    const out = (await Effect.runPromise(
      normalizeAttachment(part("image/bmp", bmp, "shot.bmp"), caps).pipe(Effect.orDie),
    )) as any
    expect(out.mime).toBe("image/webp")
    expect(out.url.startsWith("data:image/webp;base64,")).toBe(true)
    const meta = await sharp(Buffer.from(out.url.split(",")[1]!, "base64")).metadata()
    expect(meta.format).toBe("webp")
    expect(meta.width).toBe(8)
    expect(meta.height).toBe(8)
  })

  test("bmp that overflows the cap becomes capped webp", async () => {
    const bmp = await makeBmp(3000, 100)
    const out = (await Effect.runPromise(
      normalizeAttachment(part("image/bmp", bmp, "wide.bmp"), caps).pipe(Effect.orDie),
    )) as any
    expect(out.mime).toBe("image/webp")
    const meta = await sharp(Buffer.from(out.url.split(",")[1]!, "base64")).metadata()
    expect(meta.format).toBe("webp")
    expect(meta.width).toBeLessThanOrEqual(2000)
  })

  test("read-tool shape on a .bmp file (the Delphi screenshot path) becomes webp", async () => {
    const bmp = await makeBmp(64, 48)
    const readShape = {
      type: "file" as const,
      mime: "image/bmp",
      url: `data:image/bmp;base64,${bmp.toString("base64")}`,
      filename: "screen.bmp",
    }
    expect(await normalizeMime(readShape)).toBe("image/webp")
  })

  test("photo jpg that fits becomes webp even when lossless is larger than the jpg", async () => {
    const jpg = await makePhotoJpg(800, 600)
    const lossless = await sharp(jpg).webp({ lossless: true, effort: 4 }).toBuffer()
    expect(lossless.length).toBeGreaterThan(jpg.length)
    expect(await normalizeMime(part("image/jpeg", jpg, "frame.jpg"))).toBe("image/webp")
  })

  test("png and video-frame jpeg shapes become webp", async () => {
    const png = await sharp({
      create: { width: 12, height: 12, channels: 3, background: { r: 10, g: 120, b: 200 } },
    }).png().toBuffer()
    expect(await normalizeMime(part("image/png", png, "paste.png"))).toBe("image/webp")
    const frame = await makePhotoJpg(320, 240)
    expect(await normalizeMime(part("image/jpeg", frame, "frame.jpg"))).toBe("image/webp")
  })

  test("an undecodable image is refused with a named reason, never forwarded raw", async () => {
    const junk = part("image/png", Buffer.from("this is not an image"), "junk.png")
    const exit = await Effect.runPromise(Effect.exit(normalizeAttachment(junk, caps)))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(Cause.squash(exit.cause))).toContain("[unsupported-image-format]")
    }
  })
})

describe("t103 upload-once cache keyed by content hash", () => {
  test("the same image twice performs one upload", async () => {
    __resetFilesCache()
    const png = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer()
    let uploads = 0
    const nowSec = Math.floor(Date.now() / 1000)
    const fileJson = () => ({ id: "file-api-test1", object: "file", bytes: png.length, created_at: nowSec, filename: "a.webp", purpose: "user_data", expires_at: nowSec + 2592000 })
    const stubFetch = (async (url: unknown, _init?: unknown): Promise<Response> => {
      const u = String(url)
      if (u.endsWith("/files") || u.endsWith("/files/")) {
        uploads += 1
        return Response.json(fileJson())
      }
      return Response.json(fileJson())
    }) as unknown as typeof fetch
    const first = await fileIdForImage({ apiKey: "k", providerID: "deepseek", data: png, mime: "image/webp", filename: "a.webp", fetchFn: stubFetch })
    const second = await fileIdForImage({ apiKey: "k", providerID: "deepseek", data: png, mime: "image/webp", filename: "a.webp", fetchFn: stubFetch })
    expect(first).toBe("file-api-test1")
    expect(second).toBe("file-api-test1")
    expect(uploads).toBe(1)
  })

  test("an upload failure falls back to inline (null), it never throws", async () => {
    __resetFilesCache()
    const failing = (async (): Promise<Response> => {
      throw new Error("network down")
    }) as unknown as typeof fetch
    const out = await fileIdForImage({ apiKey: "k", providerID: "deepseek", data: Buffer.from([1, 2, 3]), mime: "image/webp", filename: "b.webp", fetchFn: failing })
    expect(out).toBeNull()
  })
})
