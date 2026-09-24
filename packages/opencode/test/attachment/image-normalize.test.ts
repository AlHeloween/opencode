import { describe, expect, setDefaultTimeout, test } from "bun:test"
import sharp from "sharp"
import { Effect } from "effect"
import { ImageHandler } from "@/attachment/handlers/image"

setDefaultTimeout(20_000)

const makePng = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer()

const attachment = (url: string) =>
  ({
    type: "file",
    kind: "image",
    mime: "image/png",
    filename: "shot.png",
    url,
    source: undefined,
    metadata: { _tag: "image", width: 0, height: 0 },
    display: { badge: "img", label: "shot.png" },
    provenance: { source: "user_upload" },
  }) as never

const normalize = (url: string, caps = { image: { max_width: 2000, max_height: 2000 } }) =>
  Effect.runPromise(ImageHandler.normalize!(attachment(url), caps))

describe("image attachment normalize (no blur unless it overflows)", () => {
  test("an image that fits is never degraded: lossless or untouched, pixels identical", async () => {
    const png = await makePng(800, 600)
    const out = await normalize(`data:image/png;base64,${png.toString("base64")}`)
    const original = await sharp(png).raw().toBuffer()
    const produced = await sharp(Buffer.from(out.url.split(",")[1]!, "base64")).raw().toBuffer()
    expect(produced.length).toBe(original.length)
    expect(Buffer.compare(produced, original)).toBe(0)
  })

  test("an image that overflows is downscaled to the cap (lossy pass allowed there)", async () => {
    const png = await makePng(4000, 1000)
    const out = await normalize(`data:image/png;base64,${png.toString("base64")}`)
    expect(out.mime).toBe("image/webp")
    const meta = out.metadata as { width: number; height: number }
    expect(meta.width).toBeLessThanOrEqual(2000)
    expect(meta.height).toBeLessThanOrEqual(2000)
  })
})
