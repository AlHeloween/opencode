/**
 * Media token calibration service (2026-09-07, Alexander).
 *
 * Media (video/image) does NOT count as text in the chars/4 overflow
 * estimate — providers bill media by duration/dimensions, not payload bytes
 * (measured [Exact]: 1.97 MiB mp4 → 2610 prompt tokens, video_tokens: 0).
 *
 * The REAL per-item cost is measured from the provider usage response
 * (`prompt_tokens_details.image_tokens` / `video_tokens` / `audio_tokens`
 * carried in LanguageModelUsage.raw) and folded into a per-model EMA
 * persisted in SQLite (media_token_calibration table). Estimates then use
 * the measured price: `count(media items) × tokens_per_item`.
 *
 * Modality gate: only modalities the model supports (capabilities.input.*)
 * are calibrated or estimated.
 */
import { eq, and } from "drizzle-orm"
import { MediaTokenCalibrationTable } from "./media-token-calibration.sql"
import { Database } from "@/storage/db"
import type { Provider } from "@/provider/provider"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "session.media-token-calibration" })

/** EMA smoothing: 70% old + 30% new observation. */
const EMA_ALPHA = 0.3
/** The first observation is trusted as-is (no history to smooth against). */
export type MediaModality = "video" | "image"

export function modalityFromMime(mime: string): MediaModality | undefined {
  if (mime.startsWith("video/")) return "video"
  if (mime.startsWith("image/")) return "image"
  return undefined
}

/**
 * Does the model declare input support for this modality? Unsupported
 * media is never calibrated (it should not be on the wire at all).
 */
export function modelSupports(model: Provider.Model, modality: MediaModality): boolean {
  const caps = model.capabilities?.input
  if (!caps) return false
  if (modality === "video") return caps.video === true
  if (modality === "image") return caps.image === true
  return false
}

/** In-memory read-through cache: calibration rows are tiny and hot. */
const cache = new Map<string, { tokensPerItem: number; observations: number }>()

function key(providerID: string, modelID: string, modality: MediaModality) {
  return `${providerID}\0${modelID}\0${modality}`
}

function readRow(providerID: string, modelID: string, modality: MediaModality) {
  const k = key(providerID, modelID, modality)
  const hit = cache.get(k)
  if (hit) return hit
  try {
    const row = Database.use((db) =>
      db
        .select({
          tokens_per_item: MediaTokenCalibrationTable.tokens_per_item,
          observations: MediaTokenCalibrationTable.observations,
        })
        .from(MediaTokenCalibrationTable)
        .where(
          and(
            eq(MediaTokenCalibrationTable.provider_id, providerID),
            eq(MediaTokenCalibrationTable.model_id, modelID),
            eq(MediaTokenCalibrationTable.modality, modality),
          ),
        )
        .get(),
    )
    if (!row) return undefined
    const value = { tokensPerItem: row.tokens_per_item, observations: row.observations }
    cache.set(k, value)
    return value
  } catch (e) {
    log.debug("media calibration read failed", { error: String(e) })
    return undefined
  }
}

/**
 * Fold a fresh provider measurement into the per-model EMA and persist.
 * `measuredTokens` = provider-reported tokens for the media in that request,
 * `itemCount` = number of media items of this modality in the request.
 */
export function record(input: {
  model: Provider.Model
  modality: MediaModality
  measuredTokens: number
  itemCount: number
}): void {
  if (input.itemCount <= 0) return
  if (!Number.isFinite(input.measuredTokens) || input.measuredTokens < 0) return
  if (!modelSupports(input.model, input.modality)) return

  const perItem = input.measuredTokens / input.itemCount
  const k = key(input.model.providerID, input.model.id, input.modality)
  const existing = readRow(input.model.providerID, input.model.id, input.modality)
  const tokensPerItem = existing ? existing.tokensPerItem * (1 - EMA_ALPHA) + perItem * EMA_ALPHA : perItem
  const observations = (existing?.observations ?? 0) + 1
  const now = Date.now()

  cache.set(k, { tokensPerItem, observations })
  try {
    Database.use((db) =>
      db
        .insert(MediaTokenCalibrationTable)
        .values({
          provider_id: input.model.providerID,
          model_id: input.model.id,
          modality: input.modality,
          tokens_per_item: tokensPerItem,
          observations,
          time_updated: now,
        })
        .onConflictDoUpdate({
          target: [
            MediaTokenCalibrationTable.provider_id,
            MediaTokenCalibrationTable.model_id,
            MediaTokenCalibrationTable.modality,
          ],
          set: { tokens_per_item: tokensPerItem, observations, time_updated: now },
        })
        .run(),
    )
    log.debug("media token calibration updated", {
      model: input.model.id,
      modality: input.modality,
      perItem: Math.round(perItem),
      ema: Math.round(tokensPerItem),
      observations,
    })
  } catch (e) {
    log.debug("media calibration write failed", { error: String(e) })
  }
}

/**
 * Estimated provider tokens for `count` media items of `modality` on this
 * model. Returns 0 when the model does not support the modality (media
 * should not be on the wire) or when no measurement exists yet — the
 * estimate then simply does not add phantom cost for media.
 */
export function estimate(input: {
  model: Provider.Model
  modality: MediaModality
  count: number
}): number {
  if (input.count <= 0) return 0
  if (!modelSupports(input.model, input.modality)) return 0
  const row = readRow(input.model.providerID, input.model.id, input.modality)
  if (!row) return 0
  return Math.round(row.tokensPerItem * input.count)
}

export * as MediaTokenCalibration from "./media-token-calibration"
