import { Effect } from "effect"
import type { Handler, TuiRenderResult, Embedding, EmbedOptions } from "../handler"
import type { Info as UniversalAttachment } from "../schema"
import type { Provider } from "@/provider/provider"

function detectCode(mime: string): boolean {
  return mime.startsWith("text/") && (
    mime.includes("python") || mime.includes("javascript") || mime.includes("typescript") ||
    mime.includes("java") || mime.includes("c++") || mime.includes("rust") ||
    mime.includes("css") || mime.includes("html") || mime.includes("sql") ||
    mime.includes("shell") || mime.includes("yaml") || mime.includes("xml") ||
    mime.includes("x-")
  )
}

function codeLanguage(mime: string): string {
  if (mime.includes("python")) return "python"
  if (mime.includes("typescript")) return "typescript"
  if (mime.includes("javascript")) return "javascript"
  if (mime.includes("java")) return "java"
  if (mime.includes("rust")) return "rust"
  if (mime.includes("css")) return "css"
  if (mime.includes("html")) return "html"
  if (mime.includes("sql")) return "sql"
  if (mime.includes("shell") || mime.includes("bash")) return "shell"
  if (mime.includes("yaml")) return "yaml"
  if (mime.includes("xml")) return "xml"
  return mime.split("/")[1] ?? "code"
}

export const TextHandler: Handler = {
  kind: "text",

  detect(mime: string): boolean {
    return mime.startsWith("text/") && !detectCode(mime)
  },

  classify(attachment): Effect.Effect<UniversalAttachment, Error> {
    return Effect.succeed({
      type: "file",
      kind: "text",
      mime: attachment.mime,
      filename: attachment.filename,
      url: attachment.url,
      source: attachment.source as any,
      metadata: { _tag: "text", lines: 0, chars: 0 },
      display: { badge: "txt", label: attachment.filename ?? "Text" },
      provenance: { source: "tool_output" },
    } as UniversalAttachment)
  },

  describe(attachment: UniversalAttachment): string {
    const name = attachment.filename ?? "text file"
    return `Text: ${name} (${attachment.mime})`
  },

  render(attachment: UniversalAttachment): TuiRenderResult {
    return {
      badge: { text: "txt", color: "secondary" },
      label: attachment.filename ?? attachment.mime,
    }
  },

  capability(_model: Provider.Model, _attachment: UniversalAttachment): "native" | "describe" | "extract" | "unsupported" {
    return "native" // All models support text
  },

  embed(attachment: UniversalAttachment, options: EmbedOptions): Effect.Effect<Embedding[], Error> {
    return Effect.gen(function* () {
      // TODO: chunk text and generate embeddings via endpoint
      return []
    })
  },
}

export const CodeHandler: Handler = {
  kind: "code",

  detect(mime: string): boolean {
    return detectCode(mime)
  },

  classify(attachment): Effect.Effect<UniversalAttachment, Error> {
    const language = codeLanguage(attachment.mime)
    return Effect.succeed({
      type: "file",
      kind: "code",
      mime: attachment.mime,
      filename: attachment.filename,
      url: attachment.url,
      source: attachment.source as any,
      metadata: { _tag: "code", language, lines: 0, chars: 0 },
      display: { badge: language.slice(0, 3), label: attachment.filename ?? `Code (${language})` },
      provenance: { source: "tool_output" },
    } as UniversalAttachment)
  },

  describe(attachment: UniversalAttachment): string {
    const name = attachment.filename ?? "code"
    const lang = attachment.metadata?._tag === "code" ? attachment.metadata.language : ""
    return `Code: ${name} (${lang || attachment.mime})`
  },

  render(attachment: UniversalAttachment): TuiRenderResult {
    const lang = attachment.metadata?._tag === "code" ? attachment.metadata.language : "code"
    return {
      badge: { text: lang.slice(0, 3), color: "secondary" },
      label: attachment.filename ?? attachment.mime,
    }
  },

  capability(_model: Provider.Model, _attachment: UniversalAttachment): "native" | "describe" | "extract" | "unsupported" {
    return "native"
  },

  embed(attachment: UniversalAttachment, options: EmbedOptions): Effect.Effect<Embedding[], Error> {
    return Effect.gen(function* () {
      // TODO: chunk code and generate embeddings via endpoint
      return []
    })
  },
}
