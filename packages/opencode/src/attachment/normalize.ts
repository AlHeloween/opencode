import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { fromMime } from "./kind"
import { registry } from "./registry"
import type { Info as UniversalAttachment } from "./schema"

const log = Log.create({ service: "attachment.normalize" })

/**
 * Registers every built-in handler exactly once, on first use.
 *
 * Deliberately LAZY: the handler modules pull native dependencies (sharp), and
 * importing them at module load made the compiled binary require the native
 * binding during startup — where it is only resolvable when the process cwd
 * carries the platform packages. An optional feature must not crash the
 * process, so the import happens on the first normalisation instead; if it
 * fails, the original value passes through untouched (2026-09-18).
 */
let handlersReady: Promise<void> | undefined
const registerHandlers = () => (handlersReady ??= import("./handlers/index").then(() => undefined))

/**
 * Normalise an attachment-shaped value through the handler registered for its
 * kind. Only images implement `normalize` today, so this is the single
 * conversion point for "all images become WebP" (2026-09-18, Alexander).
 *
 * Ingestion calls it once, BEFORE the value is written to the message history:
 * what is stored is what every later request sends, so the encode happens once
 * instead of on every turn. The value only needs `mime` + `url`; the result is
 * rebuilt from the ORIGINAL value so handler-only fields (`kind`) never leak
 * into a stored part. Kinds without a handler pass through untouched, and a
 * failed conversion keeps the original bytes (ImageHandler.normalize catches
 * its own decode errors).
 */
export function normalizeAttachment<
  T extends {
    mime: string
    url: string
    dimensions?: { width: number; height: number }
    durationSeconds?: number
  },
>(value: T, config?: unknown): Effect.Effect<T> {
  return Effect.gen(function* () {
    const normalized = yield* Effect.gen(function* () {
      yield* Effect.tryPromise(() => registerHandlers())
      return yield* registry.normalize(
        { ...value, kind: fromMime(value.mime) } as unknown as UniversalAttachment,
        config,
      )
    }).pipe(
      // A conversion failure must never block the message it belongs to:
      // keep the original value and record why. ImageHandler.normalize
      // already falls back to the original bytes on decode errors — this is
      // the last-resort guard, so the error channel stays `never`.
      Effect.catch((error) => {
        log.debug("attachment normalize failed, keeping original", { mime: value.mime, error: String(error) })
        return Effect.succeed(undefined)
      }),
    )
    if (!normalized) return value
    // The handler may report what it measured about the artifact — dimensions for
    // an image, duration for a video. Lift it onto the stored part: the window
    // budget prices media from those numbers, and ingestion is the only moment the
    // bytes are examined anyway. See `MessageV2.FilePart.dimensions` for why the
    // price can never be the payload.
    const measured: { dimensions?: { width: number; height: number }; durationSeconds?: number } = {}
    const md = normalized.metadata
    if (md?._tag === "image" && md.width > 0 && md.height > 0) {
      measured.dimensions = { width: md.width, height: md.height }
    }
    if (md?._tag === "video" && md.duration > 0) {
      measured.durationSeconds = md.duration
    }
    const hasMeasurement = measured.dimensions !== undefined || measured.durationSeconds !== undefined
    if (normalized.mime === value.mime && normalized.url === value.url && !hasMeasurement) return value
    return {
      ...value,
      mime: normalized.mime,
      url: normalized.url,
      ...measured,
    } as T
  })
}

/**
 * Build the STORED file part from a normalised attachment.
 *
 * ONE constructor, because assembling the part by hand is exactly how fields get
 * lost. The tool-media path and the provider-generated-image path rebuilt the
 * part field-by-field, so the moment a handler started reporting `dimensions`
 * they were dropped on both — and the six video frames `read.ts` turns into
 * `image/jpeg` parts arrived with a media price of 0 (2026-09-18).
 *
 * Anything a handler learns about the artifact belongs here, never at the call
 * site: `dimensions` and `durationSeconds` reach the stored part by construction,
 * not by remembering to copy them.
 */
export function filePartFromNormalized<
  T extends {
    mime: string
    url: string
    filename?: string
    dimensions?: { width: number; height: number }
    durationSeconds?: number
  },
  M extends string,
  S extends string,
>(normalized: T, ids: { messageID: M; sessionID: S }) {
  return {
    type: "file" as const,
    mime: normalized.mime,
    url: normalized.url,
    ...(normalized.filename ? { filename: normalized.filename } : {}),
    ...(normalized.dimensions ? { dimensions: normalized.dimensions } : {}),
    ...(normalized.durationSeconds ? { durationSeconds: normalized.durationSeconds } : {}),
    messageID: ids.messageID,
    sessionID: ids.sessionID,
  }
}
