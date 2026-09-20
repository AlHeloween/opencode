import { Effect, Schema } from "effect"
import { Global } from "@opencode-ai/core/global"
import * as Tool from "./tool"
import path from "path"
import { readStoredPart } from "../session/stored-part"
import { readImage } from "../util/image-decode"
import { halfBlockMap, outlineFromGray, outlineToSvg, outlineToText, toGray, type DiagramBox } from "../util/image-outline"

import DESCRIPTION from "./imagerender.txt"

export const Parameters = Schema.Struct({
  source: Schema.String.annotate({
    description:
      "A file path to an image, or a `prt_…` id of a stored image part (a screenshot attached to the session lives in the `part` table — its id is the address).",
  }),
  width: Schema.optional(Schema.Number).annotate({
    description: "Width of the text map in columns (default 100, clamped 40-200).",
  }),
  boxes: Schema.optional(
    Schema.Array(
      Schema.Struct({
        x: Schema.Number,
        y: Schema.Number,
        w: Schema.Number,
        h: Schema.Number,
        label: Schema.String,
        color: Schema.optional(Schema.String),
      }),
    ),
  ).annotate({
    description: "Pixel-space rectangles drawn on the SVG — the modification plan on the picture's own coordinates.",
  }),
})

const dataUrlPattern = /^data:([^;]+);base64,(.+)$/

function failure(error: string, source: string) {
  // Every return branch carries the SAME metadata keys — ExecuteResult infers one
  // union from all of them, and a key present in only one branch collapses to undefined.
  return {
    title: "imagerender: failed",
    metadata: { source, width: 0, height: 0, rows: 0, cols: 0, svg: "", bytes: 0, error },
    output: `imagerender failed: ${error}`,
  }
}

function mimeFromPath(p: string): string {
  const ext = path.extname(p).toLowerCase()
  if (ext === ".png") return "image/png"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".webp") return "image/webp"
  if (ext === ".gif") return "image/gif"
  if (ext === ".bmp") return "image/bmp"
  return "application/octet-stream"
}

export const ImageRenderTool = Tool.define(
  "imagerender",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { source: string; width?: number; boxes?: DiagramBox[] }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "imagerender",
            patterns: [params.source],
            always: ["*"],
            metadata: { source: params.source, width: params.width, boxes: params.boxes?.length ?? 0 },
          })

          const source = params.source.trim()
          let bytes: Buffer
          let mime: string
          let label: string

          if (source.startsWith("prt_")) {
            const lookup = readStoredPart({ dbPath: path.join(Global.Path.data, "opencode.db"), id: source })
            if (!lookup.ok) return failure(`stored part not readable: ${lookup.error}`, source)
            const json = lookup.part.json as { type?: string; url?: string; mime?: string; filename?: string }
            const match = typeof json.url === "string" ? json.url.match(dataUrlPattern) : null
            if (json.type !== "file" || !match) {
              return failure(`part ${source} is not a stored image (type=${String(json.type)})`, source)
            }
            bytes = Buffer.from(match[2]!, "base64")
            mime = json.mime ?? match[1]!
            label = json.filename ?? source
          } else {
            const file = Bun.file(source)
            if (!(yield* Effect.promise(() => file.exists()))) return failure(`no file at ${source}`, source)
            bytes = Buffer.from(yield* Effect.promise(() => file.arrayBuffer()))
            mime = mimeFromPath(source)
            label = path.basename(source)
          }

          // WebP-aware (util/image-decode): attachments are WebP, and the historical
          // decoder cannot read them — the same defect that showed "[image unavailable]".
          const img = yield* Effect.promise(() => readImage(bytes))
          const width = Math.max(40, Math.min(Math.round(params.width ?? 100), 200))
          const gray = toGray(img.bitmap.data as Uint8Array, img.width, img.height)
          const outline = outlineFromGray(gray, img.width, img.height)
          const map = halfBlockMap(gray, img.width, img.height, width)
          const svg = outlineToSvg({
            outline,
            dataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
            boxes: params.boxes,
          })

          const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
          const svgPath = path.join(Global.Path.data, "renders", `${hash}.svg`)
          yield* Effect.promise(() => Bun.write(svgPath, svg))

          return {
            title: `imagerender: ${label} ${img.width}x${img.height}`,
            metadata: {
              source,
              width: img.width,
              height: img.height,
              rows: outline.rows.length,
              cols: outline.cols.length,
              svg: svgPath,
              bytes: bytes.length,
              error: "",
            },
            output:
              `${outlineToText(outline)}\n\n${map}\n\n` +
              `SVG: ${svgPath}\n(${label}, ${bytes.length} bytes in, text map ${width} cols; boxes drawn: ${params.boxes?.length ?? 0})`,
          }
        }).pipe(Effect.orDie),
    }
  }),
  "imagerender",
)
