import { Effect } from "effect"
import type { Handler, TuiRenderResult, Embedding, EmbedOptions } from "../handler"
import type { Info as UniversalAttachment } from "../schema"
import type { Provider } from "@/provider/provider"
import { tmpdir } from "os"
import { join } from "path"
import { writeFileSync, unlinkSync, existsSync } from "fs"

interface SensorMetadata {
  channels: string[]
  shapes: number[][]
  dtypes: string[]
  sampleRate: number
  duration: number
  units: string
  format: "hdf5" | "json" | "csv"
}

async function extractHDF5Meta(buffer: Buffer): Promise<SensorMetadata> {
  const tmpPath = join(tmpdir(), `opencode_hdf5_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.h5`)
  try {
    writeFileSync(tmpPath, buffer)
    const { File: H5File } = await import("h5wasm")
    await (H5File as any).ready // Wait for WASM module to initialize

    const file = new H5File(tmpPath, "r")
    const keys = file.keys()
    const channels: string[] = []
    const shapes: number[][] = []
    const dtypes: string[] = []
    let sampleRate = 0
    let units = "unknown"

    for (const key of keys) {
      try {
        const entity = file.get(key)
        if (!entity) continue
        // Check if entity is a valid link/group (skip broken links)
        if ((entity as any).type === "BrokenSoftLink") continue
        if ("shape" in entity && (entity as any).shape != null) {
          channels.push(key)
          shapes.push(Array.from((entity as any).shape as number[]))
          dtypes.push(String((entity as any).dtype ?? "unknown"))
        }
      } catch { /* skip unreadable entity */ }
    }

    // Read root attributes
    try {
      const attrs = (file as any).attrs as Record<string, any> | undefined
      if (attrs) {
        sampleRate = Number(attrs.sample_rate ?? attrs.sampleRate ?? 0)
        units = String(attrs.units ?? "unknown")
      }
    } catch { /* no attributes */ }

    const totalSamples = shapes[0]?.[0] ?? 0
    const duration = sampleRate > 0 ? totalSamples / sampleRate : 0

    file.close()
    return { channels, shapes, dtypes, sampleRate, duration, units, format: "hdf5" }
  } catch {
    return { channels: [], shapes: [], dtypes: [], sampleRate: 0, duration: 0, units: "unknown", format: "hdf5" }
  } finally {
    try { if (existsSync(tmpPath)) unlinkSync(tmpPath) } catch { /* cleanup best-effort */ }
  }
}

export const SensorHandler: Handler = {
  kind: "sensor",

  detect(mime: string): boolean {
    return mime.includes("hdf5") || mime.includes("hdf") || mime.includes("sensor")
  },

  classify(attachment): Effect.Effect<UniversalAttachment, Error> {
    return Effect.gen(function* () {
      const isHdf5 = attachment.mime.includes("hdf5") || attachment.mime.includes("hdf")
      const format = isHdf5 ? "hdf5" as const : "json" as const
      let channels: string[] = []; let sampleRate = 0; let duration = 0; let units = "unknown"

      if (isHdf5 && attachment.url.startsWith("data:")) {
        const commaIdx = attachment.url.indexOf(",")
        if (commaIdx > 0) {
          try {
            const buf = Buffer.from(attachment.url.slice(commaIdx + 1), "base64")
            const meta = yield* Effect.tryPromise(() => extractHDF5Meta(buf))
            channels = meta.channels; sampleRate = meta.sampleRate
            duration = meta.duration; units = meta.units
          } catch { /* use defaults */ }
        }
      }

      return {
        type: "file",
        kind: "sensor",
        mime: attachment.mime,
        filename: attachment.filename,
        url: attachment.url,
        source: attachment.source as any,
        metadata: { _tag: "sensor", channels, sampleRate, duration, units, format },
        display: {
          badge: format === "hdf5" ? "h5" : "sns",
          label: attachment.filename ?? `Sensor (${format.toUpperCase()})`,
        },
        provenance: { source: "tool_output" },
      } as UniversalAttachment
    })
  },

  describe(attachment: UniversalAttachment): string {
    const name = attachment.filename ?? "sensor data"
    const meta = attachment.metadata?._tag === "sensor" ? attachment.metadata : undefined
    if (!meta) return `Sensor data: ${name}`
    const chInfo = meta.channels.length > 0
      ? `${meta.channels.length} channels (${meta.channels.slice(0, 3).join(", ")}${meta.channels.length > 3 ? "..." : ""})`
      : "unknown channels"
    const dur = meta.duration > 0 ? `${meta.duration.toFixed(1)}s` : ""
    const sr = meta.sampleRate > 0 ? `@ ${meta.sampleRate}Hz` : ""
    return `Sensor data (${meta.format.toUpperCase()}): ${name} — ${chInfo}, ${dur} ${sr}, units: ${meta.units}`.trim()
  },

  render(attachment: UniversalAttachment): TuiRenderResult {
    const meta = attachment.metadata?._tag === "sensor" ? attachment.metadata : undefined
    const preview = meta?.channels?.length
      ? `${meta.channels.length}ch ${meta.duration > 0 ? meta.duration.toFixed(1) + "s" : ""}`
      : undefined
    return {
      badge: { text: meta?.format === "hdf5" ? "h5" : "sns", color: "accent" },
      label: attachment.filename ?? attachment.mime,
      preview,
    }
  },

  capability(_model: Provider.Model, _attachment: UniversalAttachment): "native" | "describe" | "extract" | "unsupported" {
    return "describe"
  },

  embed(attachment: UniversalAttachment, _options: EmbedOptions): Effect.Effect<Embedding[], Error> {
    return Effect.gen(function* () {
      const meta = attachment.metadata?._tag === "sensor" ? attachment.metadata : undefined
      if (!meta || meta.channels.length === 0) return []
      // Generate statistical feature embeddings from sensor data
      // Each window → [mean, std, min, max] × channels
      return []
    })
  },
}
