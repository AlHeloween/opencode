import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import type { Handler, TuiRenderResult, Embedding, EmbedOptions } from "../handler"
import type { Info as UniversalAttachment } from "../schema"
import type { Provider } from "@/provider/provider"
import { parseBuffer } from "music-metadata"

const log = Log.create({ service: "attachment.audio" })

async function extractAudioMeta(buffer: Buffer): Promise<{
  duration: number; sampleRate: number; channels: number; codec?: string
}> {
  try {
    const meta = await parseBuffer(buffer)
    return {
      duration: meta.format.duration ?? 0,
      sampleRate: meta.format.sampleRate ?? 44100,
      channels: meta.format.numberOfChannels ?? 1,
      codec: meta.format.codec ?? undefined,
    }
  } catch {
    return { duration: 0, sampleRate: 44100, channels: 1 }
  }
}

export const AudioHandler: Handler = {
  kind: "audio",

  detect(mime: string): boolean {
    return mime.startsWith("audio/")
  },

  classify(attachment): Effect.Effect<UniversalAttachment, Error> {
    return Effect.gen(function* () {
      let duration = 0; let sampleRate = 44100; let channels = 1; let codec: string | undefined
      // Extract base64 data if URL is a data: URI
      if (attachment.url.startsWith("data:")) {
        const commaIdx = attachment.url.indexOf(",")
        if (commaIdx > 0) {
          const base64 = attachment.url.slice(commaIdx + 1)
          try {
            const buf = Buffer.from(base64, "base64")
            const meta = yield* Effect.tryPromise(() => extractAudioMeta(buf))
            duration = meta.duration; sampleRate = meta.sampleRate
            channels = meta.channels; codec = meta.codec
          } catch (e) { log.debug("audio metadata extraction failed", { error: String(e) }) }
        }
      }
      return {
        type: "file",
        kind: "audio",
        mime: attachment.mime,
        filename: attachment.filename,
        url: attachment.url,
        source: attachment.source as any,
        metadata: { _tag: "audio", duration, sampleRate, channels, codec },
        display: { badge: "wav", label: attachment.filename ?? "Audio" },
        provenance: { source: "tool_output" },
      } as UniversalAttachment
    })
  },

  describe(attachment: UniversalAttachment): string {
    const name = attachment.filename ?? "audio"
    const meta = attachment.metadata?._tag === "audio" ? attachment.metadata : undefined
    const dur = meta?.duration ? ` ${meta.duration.toFixed(1)}s` : ""
    const hz = meta?.sampleRate ? ` ${(meta.sampleRate / 1000).toFixed(1)}kHz` : ""
    const ch = meta?.channels ? (meta.channels === 1 ? "mono" : "stereo") : ""
    return `Audio: ${name}${dur}${hz} ${ch} (${attachment.mime})`.trim()
  },

  render(attachment: UniversalAttachment): TuiRenderResult {
    const meta = attachment.metadata?._tag === "audio" ? attachment.metadata : undefined
    const preview = meta?.duration ? `${meta.duration.toFixed(1)}s` : undefined
    return {
      badge: { text: attachment.mime.split("/")[1]?.slice(0, 3) ?? "aud", color: "secondary" },
      label: attachment.filename ?? attachment.mime,
      preview,
    }
  },

  capability(model: Provider.Model, _attachment: UniversalAttachment): "native" | "describe" | "extract" | "unsupported" {
    if (model.capabilities?.input?.audio) return "native"
    return "describe"
  },

  embed(_attachment: UniversalAttachment, _options: EmbedOptions): Effect.Effect<Embedding[], Error> {
    return Effect.succeed([])
  },
}
