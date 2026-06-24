import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import AdmZip from "adm-zip"
import sharp from "sharp"
import { pack as tarPack } from "tar-stream"
import { readFileSync, unlinkSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { AudioHandler } from "../../src/attachment/handlers/audio"
import { VideoHandler } from "../../src/attachment/handlers/video"
import { SensorHandler } from "../../src/attachment/handlers/sensor"
import { ImageHandler } from "../../src/attachment/handlers/image"
import { ArchiveHandler } from "../../src/attachment/handlers/archive"

function dataUrl(mime: string, buffer: Buffer) {
  return `data:${mime};base64,${buffer.toString("base64")}`
}

function wavFixture() {
  const sampleRate = 8000
  const samples = 800
  const dataSize = samples * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write("RIFF", 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write("WAVE", 8)
  buffer.write("fmt ", 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write("data", 36)
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}

function mp4TkhdFixture(width: number, height: number) {
  const buffer = Buffer.alloc(128)
  buffer.writeUInt32BE(92, 0)
  buffer.write("tkhd", 4)
  buffer.writeUInt32BE(width << 16, 84)
  buffer.writeUInt32BE(height << 16, 88)
  return buffer
}

async function tarFixture() {
  const pack = tarPack()
  const chunks: Buffer[] = []
  pack.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
  const done = new Promise<Buffer>((resolve, reject) => {
    pack.on("end", () => resolve(Buffer.concat(chunks)))
    pack.on("error", reject)
  })
  pack.entry({ name: "one.txt" }, "one")
  pack.entry({ name: "nested/two.txt" }, "two")
  pack.finalize()
  return done
}

async function hdf5Fixture() {
  const path = join(tmpdir(), `opencode_sensor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.h5`)
  const h5wasm = await import("h5wasm/node")
  await h5wasm.ready
  const file = new h5wasm.File(path, "w")
  file.create_dataset({ name: "accel", data: new Float32Array([1, 2, 3, 4]), shape: [4], dtype: "<f" })
  file.create_attribute("sample_rate", 2)
  file.create_attribute("units", "m/s2")
  file.close()
  const buffer = readFileSync(path)
  unlinkSync(path)
  return buffer
}

describe("attachment handlers", () => {
  test("audio handler extracts WAV metadata", async () => {
    const attachment = await Effect.runPromise(AudioHandler.classify({
      type: "file",
      mime: "audio/wav",
      filename: "tone.wav",
      url: dataUrl("audio/wav", wavFixture()),
    }))

    expect(attachment.kind).toBe("audio")
    expect(attachment.metadata?._tag).toBe("audio")
    if (attachment.metadata?._tag !== "audio") return
    expect(attachment.metadata.sampleRate).toBe(8000)
    expect(attachment.metadata.channels).toBe(1)
    expect(attachment.metadata.duration).toBeGreaterThan(0.09)
    expect(attachment.metadata.duration).toBeLessThan(0.11)
  })

  test("video handler extracts MP4 track dimensions from headers", async () => {
    const attachment = await Effect.runPromise(VideoHandler.classify({
      type: "file",
      mime: "video/mp4",
      filename: "clip.mp4",
      url: dataUrl("video/mp4", mp4TkhdFixture(640, 360)),
    }))

    expect(attachment.kind).toBe("video")
    expect(attachment.metadata?._tag).toBe("video")
    if (attachment.metadata?._tag !== "video") return
    expect(attachment.metadata.width).toBe(640)
    expect(attachment.metadata.height).toBe(360)
  })

  test("image handler classifies and resizes generated PNG data", async () => {
    const original = await sharp({
      create: {
        width: 32,
        height: 18,
        channels: 3,
        background: "#336699",
      },
    }).png().toBuffer()
    const attachment = await Effect.runPromise(ImageHandler.classify({
      type: "file",
      mime: "image/png",
      filename: "sample.png",
      url: dataUrl("image/png", original),
    }))

    expect(attachment.kind).toBe("image")
    expect(attachment.metadata?._tag).toBe("image")
    if (attachment.metadata?._tag !== "image") return
    expect(attachment.metadata.width).toBe(32)
    expect(attachment.metadata.height).toBe(18)

    const normalized = await Effect.runPromise(ImageHandler.normalize!(attachment, { image: { max_width: 8, max_height: 8 } }))
    const resized = Buffer.from(normalized.url.slice(normalized.url.indexOf(",") + 1), "base64")
    const metadata = await sharp(resized).metadata()
    expect(metadata.width).toBeLessThanOrEqual(8)
    expect(metadata.height).toBeLessThanOrEqual(8)
  })

  test("archive handler lists ZIP and TAR entries", async () => {
    const zip = new AdmZip()
    zip.addFile("one.txt", Buffer.from("one"))
    zip.addFile("nested/two.txt", Buffer.from("two"))
    const zipAttachment = await Effect.runPromise(ArchiveHandler.classify({
      type: "file",
      mime: "application/zip",
      filename: "files.zip",
      url: dataUrl("application/zip", zip.toBuffer()),
    }))

    expect(zipAttachment.metadata?._tag).toBe("archive")
    if (zipAttachment.metadata?._tag !== "archive") return
    expect(zipAttachment.metadata.fileCount).toBe(2)
    expect(zipAttachment.metadata.uncompressedSize).toBe(6)

    const tarAttachment = await Effect.runPromise(ArchiveHandler.classify({
      type: "file",
      mime: "application/x-tar",
      filename: "files.tar",
      url: dataUrl("application/x-tar", await tarFixture()),
    }))

    expect(tarAttachment.metadata?._tag).toBe("archive")
    if (tarAttachment.metadata?._tag !== "archive") return
    expect(tarAttachment.metadata.fileCount).toBe(2)
    expect(tarAttachment.metadata.uncompressedSize).toBe(6)
  })

  test("sensor handler extracts HDF5 dataset metadata", async () => {
    const attachment = await Effect.runPromise(SensorHandler.classify({
      type: "file",
      mime: "application/x-hdf5",
      filename: "sensor.h5",
      url: dataUrl("application/x-hdf5", await hdf5Fixture()),
    }))

    expect(attachment.kind).toBe("sensor")
    expect(attachment.metadata?._tag).toBe("sensor")
    if (attachment.metadata?._tag !== "sensor") return
    expect(attachment.metadata.channels).toEqual(["accel"])
    expect(attachment.metadata.sampleRate).toBe(2)
    expect(attachment.metadata.duration).toBe(2)
    expect(attachment.metadata.units).toBe("m/s2")
  })
})
