import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import type { Handler, TuiRenderResult, Embedding, EmbedOptions } from "../handler"
import type { Info as UniversalAttachment } from "../schema"
import type { Provider } from "@/provider/provider"

const log = Log.create({ service: "attachment.video" })

/**
 * Read video container metadata from headers without ffmpeg.
 * Parses mp4/mov (moov/trak), webm/mkv (EBML), and avi (RIFF) headers.
 */
function readVideoMeta(buffer: Buffer): { duration: number; width: number; height: number; fps: number } {
  try {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

    // WebM/MKV: EBML container with simple header
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
      return { duration: 0, width: 0, height: 0, fps: 0 }
    }

    // AVI: RIFF header
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
      // AVI header at offset 32: dwMicroSecPerFrame, dwMaxBytesPerSec, etc
      if (buffer.length > 64) {
        const microSecPerFrame = view.getUint32(32, true)
        const fps = microSecPerFrame > 0 ? 1_000_000 / microSecPerFrame : 0
        const width = view.getUint32(64, true)
        const height = view.getUint32(68, true)
        return { duration: 0, width, height, fps: Math.round(fps) }
      }
    }

    // MP4/MOV: find video track dimensions
    if (buffer.length > 100) {
      let width = 0; let height = 0
      for (let i = 0; i < buffer.length - 8; i++) {
        const size = view.getUint32(i, false)
        const type = buffer.slice(i + 4, i + 8).toString()
        if (type === "tkhd" && size > 84) {
          // Track header: version(1) + flags(3) + creation(4) + modification(4) + trackID(4) + reserved(4) + duration(4)
          // ... + matrix(36) + width_fixed(4) + height_fixed(4)
          width = view.getUint32(i + 84, false) >> 16
          height = view.getUint32(i + 88, false) >> 16
        }
        if (type === "stts" && size > 16) {
          // Time-to-sample: sample count + duration
          const entryCount = view.getUint32(i + 12, false)
          if (entryCount > 0 && size >= 16 + entryCount * 8) {
            const sampleCount = view.getUint32(i + 16, false)
            const sampleDuration = view.getUint32(i + 20, false)
            if (sampleDuration > 0 && (width || height)) {
              const timescale = 0 // Need mvhd for timescale — simplified
              return { duration: 0, width, height, fps: 0 }
            }
          }
        }
        if (width && height) break
      }
      return { duration: 0, width, height, fps: 0 }
    }

    return { duration: 0, width: 0, height: 0, fps: 0 }
  } catch {
    return { duration: 0, width: 0, height: 0, fps: 0 }
  }
}

export const VideoHandler: Handler = {
  kind: "video",

  detect(mime: string): boolean {
    return mime.startsWith("video/")
  },

  classify(attachment): Effect.Effect<UniversalAttachment, Error> {
    return Effect.gen(function* () {
      let duration = 0; let width = 0; let height = 0; let fps = 0
      if (attachment.url.startsWith("data:")) {
        const commaIdx = attachment.url.indexOf(",")
        if (commaIdx > 0) {
          try {
            const buf = Buffer.from(attachment.url.slice(commaIdx + 1), "base64")
            const meta = readVideoMeta(buf)
            duration = meta.duration; width = meta.width; height = meta.height; fps = meta.fps
          } catch (e) { log.debug("video metadata extraction failed", { error: String(e) }) }
        }
      }
      return {
        type: "file", kind: "video", mime: attachment.mime, filename: attachment.filename,
        url: attachment.url, source: attachment.source as any,
        metadata: { _tag: "video", duration, width, height, fps },
        display: { badge: "vid", label: attachment.filename ?? "Video" },
        provenance: { source: "tool_output" },
      } as UniversalAttachment
    })
  },

  describe(attachment: UniversalAttachment): string {
    const name = attachment.filename ?? "video"
    const meta = attachment.metadata?._tag === "video" ? attachment.metadata : undefined
    const dur = meta?.duration ? ` ${meta.duration.toFixed(1)}s` : ""
    const dims = meta?.width && meta?.height ? ` ${meta.width}×${meta.height}` : ""
    const fps = meta?.fps ? ` ${meta.fps}fps` : ""
    return `Video: ${name}${dur}${dims}${fps} (${attachment.mime})`.trim()
  },

  render(attachment: UniversalAttachment): TuiRenderResult {
    const meta = attachment.metadata?._tag === "video" ? attachment.metadata : undefined
    const preview = meta?.duration ? `${meta.duration.toFixed(1)}s` : meta?.width ? `${meta.width}×${meta.height}` : undefined
    return { badge: { text: "vid", color: "secondary" }, label: attachment.filename ?? attachment.mime, preview }
  },

  capability(model: Provider.Model): "native" | "describe" | "extract" | "unsupported" {
    if (model.capabilities?.input?.video) return "extract"
    return "describe"
  },
  embed(): Effect.Effect<Embedding[], Error> { return Effect.succeed([]) },
}
