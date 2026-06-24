import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { AudioHandler } from "../../src/attachment/handlers/audio"
import type { Info as UniversalAttachment } from "../../src/attachment/schema"

// Minimal valid WAV file (44-byte header + 4 bytes of silence)
function makeWavBuffer(): Buffer {
  const sampleRate = 44100
  const numChannels = 2
  const bitsPerSample = 16
  const dataSize = 4
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)

  const buf = Buffer.alloc(44 + dataSize)
  buf.write("RIFF", 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write("WAVE", 8)
  buf.write("fmt ", 12)
  buf.writeUInt32LE(16, 16)          // chunk size
  buf.writeUInt16LE(1, 20)           // PCM
  buf.writeUInt16LE(numChannels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(byteRate, 28)
  buf.writeUInt16LE(numChannels * (bitsPerSample / 8), 32)
  buf.writeUInt16LE(bitsPerSample, 34)
  buf.write("data", 36)
  buf.writeUInt32LE(dataSize, 40)
  return buf
}

function makeDataUrl(buf: Buffer, mime: string): string {
  return `data:${mime};base64,${buf.toString("base64")}`
}

function makeAttachment(url: string, mime: string, filename?: string): UniversalAttachment {
  return {
    type: "file",
    kind: "audio",
    mime,
    filename,
    url,
  } as UniversalAttachment
}

describe("AudioHandler", () => {
  test("detect returns true for audio/ mime types", () => {
    expect(AudioHandler.detect("audio/mpeg")).toBe(true)
    expect(AudioHandler.detect("audio/wav")).toBe(true)
    expect(AudioHandler.detect("audio/ogg")).toBe(true)
    expect(AudioHandler.detect("audio/flac")).toBe(true)
    expect(AudioHandler.detect("video/mp4")).toBe(false)
    expect(AudioHandler.detect("image/png")).toBe(false)
  })

  test("classify extracts metadata from WAV data URL", async () => {
    const wav = makeWavBuffer()
    const url = makeDataUrl(wav, "audio/wav")
    const att = makeAttachment(url, "audio/wav", "test.wav")

    const result = await Effect.runPromise(AudioHandler.classify(att).pipe(Effect.orDie))

    expect(result.kind).toBe("audio")
    expect(result.mime).toBe("audio/wav")
    const wavMeta = result.metadata as any
    expect(wavMeta).toBeDefined()
    expect(wavMeta._tag).toBe("audio")
    expect(wavMeta.sampleRate).toBe(44100)
    expect(wavMeta.channels).toBe(2)
    expect(result.display?.badge).toBe("wav")
  })

  test("classify handles non-data URL", async () => {
    const att = makeAttachment("https://example.com/audio.mp3", "audio/mpeg", "song.mp3")
    const result = await Effect.runPromise(AudioHandler.classify(att).pipe(Effect.orDie))

    expect(result.kind).toBe("audio")
    expect(result.filename).toBe("song.mp3")
    expect((result.metadata as any)?.duration).toBe(0)
  })

  test("classify handles non-data URL", async () => {
    const att = makeAttachment("https://example.com/audio.mp3", "audio/mpeg", "song.mp3")
    const result = await Effect.runPromise(AudioHandler.classify(att).pipe(Effect.orDie))

    expect(result.kind).toBe("audio")
    expect(result.filename).toBe("song.mp3")
    expect((result.metadata as any)?.duration).toBe(0)
  })

  test("describe formats audio info", () => {
    const att: UniversalAttachment = {
      type: "file", kind: "audio", mime: "audio/wav",
      url: "data:audio/wav;base64,AAA", filename: "recording.wav",
      metadata: { _tag: "audio", duration: 3.5, sampleRate: 44100, channels: 2, codec: "pcm" },
    } as UniversalAttachment

    const desc = AudioHandler.describe(att)
    expect(desc).toContain("recording.wav")
    expect(desc).toContain("3.5s")
    expect(desc).toContain("44")
    expect(desc).toContain("stereo")
  })

  test("render returns TUI badge", () => {
    const att: UniversalAttachment = {
      type: "file", kind: "audio", mime: "audio/mp3",
      url: "data:audio/mp3;base64,AAA", filename: "song.mp3",
      metadata: { _tag: "audio", duration: 120, sampleRate: 48000, channels: 1 },
    } as UniversalAttachment

    const rendered = AudioHandler.render(att)
    expect(rendered.badge.text).toBe("mp3")
    expect(rendered.label).toBe("song.mp3")
    expect(rendered.preview).toBe("120.0s")
  })

  test("capability returns native for audio-capable models", () => {
    const capModel = { capabilities: { input: { audio: true } } } as any
    const noCapModel = { capabilities: { input: { audio: false } } } as any

    expect(AudioHandler.capability(capModel, {} as any)).toBe("native")
    expect(AudioHandler.capability(noCapModel, {} as any)).toBe("describe")
  })
})
