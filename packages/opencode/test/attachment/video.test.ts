import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { VideoHandler } from "../../src/attachment/handlers/video"

// Minimal valid AVI file (RIFF header + AVI chunk)
function makeAviBuffer(width: number, height: number): Buffer {
  // RIFF header: "RIFF" + size + "AVI "
  // Then "LIST" + size + "hdrl" + "avih" + data
  const riffHeader = Buffer.alloc(12)
  riffHeader.write("RIFF", 0)
  riffHeader.writeUInt32LE(192, 4) // file size - 8
  riffHeader.write("AVI ", 8)

  // LIST hdrl
  const hdrlHeader = Buffer.alloc(12)
  hdrlHeader.write("LIST", 0)
  hdrlHeader.writeUInt32LE(116, 4)
  hdrlHeader.write("hdrl", 8)

  // avih chunk (64 bytes)
  const avih = Buffer.alloc(68)
  avih.write("avih", 0)
  avih.writeUInt32LE(56, 4) // chunk size
  avih.writeUInt32LE(33333, 8) // microSecPerFrame (~30 fps)
  avih.writeUInt32LE(0, 12) // maxBytesPerSec
  avih.writeUInt32LE(0, 16) // paddingGranularity
  avih.writeUInt32LE(0x110, 20) // flags
  avih.writeUInt32LE(1, 24) // totalFrames
  avih.writeUInt32LE(0, 28) // initialFrames
  avih.writeUInt32LE(1, 32) // streams
  avih.writeUInt32LE(0, 36) // suggestedBufferSize
  avih.writeUInt32LE(width, 40)
  avih.writeUInt32LE(height, 44)
  avih.writeUInt32LE(0, 48)
  avih.writeUInt32LE(0, 52)
  avih.writeUInt32LE(0, 56)
  avih.writeUInt32LE(0, 60)

  return Buffer.concat([riffHeader, hdrlHeader, avih])
}

function makeDataUrl(buf: Buffer, mime: string): string {
  return `data:${mime};base64,${buf.toString("base64")}`
}

describe("VideoHandler", () => {
  test("detect returns true for video/ mime types", () => {
    expect(VideoHandler.detect("video/mp4")).toBe(true)
    expect(VideoHandler.detect("video/webm")).toBe(true)
    expect(VideoHandler.detect("video/avi")).toBe(true)
    expect(VideoHandler.detect("image/png")).toBe(false)
    expect(VideoHandler.detect("audio/mp3")).toBe(false)
  })

  test("classify extracts dimensions from AVI data URL", async () => {
    const avi = makeAviBuffer(640, 480)
    const url = makeDataUrl(avi, "video/avi")
    const att = { type: "file", kind: "video", mime: "video/avi", url } as any

    const result = await Effect.runPromise(VideoHandler.classify(att).pipe(Effect.orDie))

    expect(result.kind).toBe("video")
    const meta = result.metadata as any
    expect(meta).toBeDefined()
    expect(meta._tag).toBe("video")
    expect(meta.width).toBe(640)
    expect(meta.height).toBe(480)
    expect(meta.fps).toBe(30) // 1_000_000 / 33333 = 30
  })

  test("classify handles non-AVI files gracefully", async () => {
    const buf = Buffer.from("not a video file")
    const url = makeDataUrl(buf, "video/avi")
    const att = { type: "file", kind: "video", mime: "video/avi", url } as any

    const result = await Effect.runPromise(VideoHandler.classify(att).pipe(Effect.orDie))

    expect(result.kind).toBe("video")
    expect((result.metadata as any).width).toBe(0)
  })

  test("classify handles non-data URL", async () => {
    const att = { type: "file", kind: "video", mime: "video/mp4", url: "https://example.com/video.mp4" } as any
    const result = await Effect.runPromise(VideoHandler.classify(att).pipe(Effect.orDie))

    expect(result.kind).toBe("video")
    expect((result.metadata as any).width).toBe(0)
  })

  test("describe formats video info", () => {
    const att: any = {
      kind: "video", mime: "video/mp4", filename: "clip.mp4",
      metadata: { _tag: "video", duration: 120, width: 1920, height: 1080, fps: 30 },
    }
    const desc = VideoHandler.describe(att)
    expect(desc).toContain("clip.mp4")
    expect(desc).toContain("120.0s")
    expect(desc).toContain("1920")
    expect(desc).toContain("1080")
  })

  test("render returns TUI badge", () => {
    const att: any = {
      kind: "video", mime: "video/mp4", filename: "movie.mp4",
      metadata: { _tag: "video", width: 1280, height: 720 },
    }
    const rendered = VideoHandler.render(att)
    expect(rendered.badge.text).toBe("vid")
    expect(rendered.label).toBe("movie.mp4")
    expect(rendered.preview).toBe("1280×720")
  })

  test("capability returns extract for video-capable models", () => {
    expect(VideoHandler.capability({ capabilities: { input: { video: true } } } as any, {} as any)).toBe("extract")
    expect(VideoHandler.capability({ capabilities: { input: { video: false } } } as any, {} as any)).toBe("describe")
  })
})
