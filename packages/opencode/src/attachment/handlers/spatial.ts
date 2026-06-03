import { Effect } from "effect"
import type { Handler, TuiRenderResult, Embedding, EmbedOptions } from "../handler"
import type { Info as UniversalAttachment } from "../schema"
import type { Provider } from "@/provider/provider"

/** Parse GLB binary header to get vertex count from mesh data */
function readGLBMeta(buffer: Buffer): { vertexCount: number; format: string } {
  try {
    // GLB header: magic(4) + version(4) + length(4) = 12 bytes
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    if (view.getUint32(0, true) !== 0x46546C67) return { vertexCount: 0, format: "unknown" } // "glTF" LE

    // JSON chunk: chunkLength(4) + chunkType(4) + chunkData
    const jsonChunkLength = view.getUint32(12, true)
    const jsonData = buffer.slice(20, 20 + jsonChunkLength).toString("utf-8")
    const gltf = JSON.parse(jsonData)

    let vertexCount = 0
    for (const mesh of gltf.meshes ?? []) {
      for (const prim of mesh.primitives ?? []) {
        if (gltf.accessors && prim.attributes) {
          const posAccessor = gltf.accessors[prim.attributes.POSITION]
          if (posAccessor?.count) vertexCount += posAccessor.count
        }
      }
    }

    return { vertexCount, format: "glb" }
  } catch {
    return { vertexCount: 0, format: "unknown" }
  }
}

function readGLTFMeta(text: string): { vertexCount: number; format: string } {
  try {
    const gltf = JSON.parse(text)
    let vertexCount = 0
    for (const mesh of gltf.meshes ?? []) {
      for (const prim of mesh.primitives ?? []) {
        if (gltf.accessors && prim.attributes) {
          const posAccessor = gltf.accessors[prim.attributes.POSITION]
          if (posAccessor?.count) vertexCount += posAccessor.count
        }
      }
    }
    return { vertexCount, format: "gltf" }
  } catch {
    return { vertexCount: 0, format: "unknown" }
  }
}

export const SpatialHandler: Handler = {
  kind: "spatial",

  detect(mime: string): boolean {
    return mime.includes("gltf") || mime.includes("glb") || mime.includes("model/") || mime.includes("obj") || mime.includes("stl")
  },

  classify(attachment): Effect.Effect<UniversalAttachment, Error> {
    return Effect.gen(function* () {
      let vertexCount = 0; let format = attachment.mime.includes("glb") ? "glb" : attachment.mime.includes("gltf") ? "gltf" : attachment.mime.split("/")[1] ?? "3d"
      if (attachment.url.startsWith("data:")) {
        const commaIdx = attachment.url.indexOf(",")
        if (commaIdx > 0) {
          try {
            const buf = Buffer.from(attachment.url.slice(commaIdx + 1), "base64")
            if (attachment.mime.includes("glb") || buf[0] === 0x67 && buf[1] === 0x6C && buf[2] === 0x54 && buf[3] === 0x46) {
              const meta = readGLBMeta(buf)
              vertexCount = meta.vertexCount; format = meta.format
            } else if (attachment.mime.includes("gltf") || attachment.mime === "model/gltf+json") {
              const text = buf.toString("utf-8")
              const meta = readGLTFMeta(text)
              vertexCount = meta.vertexCount; format = meta.format
            }
          } catch { /* parse failed */ }
        }
      }
      return {
        type: "file", kind: "spatial", mime: attachment.mime, filename: attachment.filename,
        url: attachment.url, source: attachment.source as any,
        metadata: { _tag: "spatial", format, vertexCount },
        display: { badge: "3d", label: attachment.filename ?? `3D (${format.toUpperCase()})` },
        provenance: { source: "tool_output" },
      } as UniversalAttachment
    })
  },

  describe(attachment: UniversalAttachment): string {
    const name = attachment.filename ?? "3D model"
    const meta = attachment.metadata?._tag === "spatial" ? attachment.metadata : undefined
    const fmt = meta?.format?.toUpperCase() ?? "3D"
    const verts = meta?.vertexCount ? ` ${meta.vertexCount.toLocaleString()} vertices` : ""
    return `3D Model (${fmt}): ${name}${verts}`
  },

  render(attachment: UniversalAttachment): TuiRenderResult {
    const meta = attachment.metadata?._tag === "spatial" ? attachment.metadata : undefined
    return {
      badge: { text: "3d", color: "accent" },
      label: attachment.filename ?? attachment.mime,
      preview: meta?.vertexCount ? `${meta.vertexCount.toLocaleString()} verts` : undefined,
    }
  },

  capability(): "describe" { return "describe" },
  embed(): Effect.Effect<Embedding[], Error> { return Effect.succeed([]) },
}
