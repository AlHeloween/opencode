export * as AttachmentRegistry from "./registry"

import { Effect, Context, Layer } from "effect"
import { fromMime, type Kind } from "./kind"
import type { Info as UniversalAttachment } from "./schema"
import type { Handler, TuiRenderResult, Embedding, EmbedOptions } from "./handler"
import type { Provider } from "@/provider/provider"

/**
 * Central registry for attachment kind handlers.
 *
 * Adding a new attachment kind:
 *   1. Add the kind to AttachmentKind.Kind
 *   2. Implement the Handler interface
 *   3. Call registry.register(handler)
 */
function createRegistry() {
  const handlers = new Map<Kind, Handler>()

  const api = {
    register(handler: Handler): void {
      handlers.set(handler.kind, handler)
    },

    getHandler(kind: Kind): Handler | undefined {
      return handlers.get(kind)
    },

    classify(raw: { type: string; mime: string; filename?: string; url: string; source?: unknown }): Effect.Effect<UniversalAttachment, Error> {
      return Effect.gen(function* () {
        const kind = fromMime(raw.mime)
        const handler = handlers.get(kind)
        if (handler) {
          return yield* handler.classify(raw)
        }
        const binaryHandler = handlers.get("binary")
        if (binaryHandler) {
          return yield* binaryHandler.classify(raw)
        }
        return {
          type: "file",
          kind: "binary" as Kind,
          mime: raw.mime,
          filename: raw.filename,
          url: raw.url,
          source: raw.source,
          metadata: { _tag: "binary", size: 0 },
          display: { badge: "bin", label: raw.filename ?? "Binary" },
        } as UniversalAttachment
      })
    },

    describe(attachment: UniversalAttachment): string {
      const handler = handlers.get(attachment.kind)
      return handler?.describe(attachment) ?? `Attachment: ${attachment.mime}`
    },

    normalize(attachment: UniversalAttachment, config?: unknown): Effect.Effect<UniversalAttachment, Error> {
      return Effect.gen(function* () {
        const handler = handlers.get(attachment.kind)
        if (handler?.normalize) {
          return yield* handler.normalize(attachment, config)
        }
        return attachment
      })
    },

    render(attachment: UniversalAttachment): TuiRenderResult {
      const handler = handlers.get(attachment.kind)
      return handler?.render(attachment) ?? {
        badge: { text: attachment.mime.split("/")[1] ?? "?", color: "secondary" },
        label: attachment.filename ?? attachment.mime,
      }
    },

    capability(model: Provider.Model, attachment: UniversalAttachment): "native" | "describe" | "extract" | "unsupported" {
      const handler = handlers.get(attachment.kind)
      return handler?.capability(model, attachment) ?? "describe"
    },

    embed(attachment: UniversalAttachment, options: EmbedOptions): Effect.Effect<Embedding[], Error> {
      return Effect.gen(function* () {
        const handler = handlers.get(attachment.kind)
        if (handler?.embed) {
          return yield* handler.embed(attachment, options)
        }
        return []
      })
    },

    getHandlers(): ReadonlyMap<Kind, Handler> {
      return handlers
    },

    isMedia(mime: string): boolean {
      const kind = fromMime(mime)
      return kind === "image" || kind === "image_vector" || kind === "audio" || kind === "video" || kind === "document"
    },

    isImage(mime: string): boolean {
      const kind = fromMime(mime)
      return kind === "image" && !mime.includes("svg") && !mime.includes("fastbidsheet")
    },

    isPdf(mime: string): boolean {
      return mime === "application/pdf"
    },
  }

  return api
}

/** Singleton registry instance */
export const registry = createRegistry()

/** Effect service wrapper */
export interface ServiceInterface extends ReturnType<typeof createRegistry> {}

export class Service extends Context.Service<Service, ServiceInterface>()("@opencode/AttachmentRegistry") {
  static readonly layer = Layer.succeed(Service, createRegistry() as unknown as ServiceInterface)
}
