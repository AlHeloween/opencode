
// ===== FILE: packages/opencode/src/session/overflow.ts =====
import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import type { MessageV2 } from "./message-v2"
import { TokenCalibration } from "./token-calibration"
import { MediaTokenCalibration } from "./media-token-calibration"

/** Cap on output-token reserve so huge max_output does not erase 1M windows. */
const MAX_OUTPUT_RESERVE_TOKENS = 32_768
const FALLBACK_OUTPUT_RESERVE_TOKENS = 8_192

/** Content body heuristic: ~1 token per 4 symbols (chars). Cadence uses this alone. */
export const CHARS_PER_TOKEN = 4

/**
 * Empirical full-request overhead (system prefix, tools schema, framing).
 * Validated across providers/windows: tokenizers systematically undercount the
 * real request; `content/4 + 10_000` tracks provider limits better.
 * Used only on **safety / fit** paths — never on Layer-1 open-window cadence.
 */
export const REQUEST_OVERHEAD_TOKENS = 10_000

/**
 * Default tokens reserved under model limit for a **normal LLM turn**
 * (framing + output). Mechanistic compact is zero-token — no separate
 * "leave 15%/20k for compaction model call" slab.
 */
export function defaultUsableReserved(model: Provider.Model): number {
  const out = model.limit.output ?? 0
  const outputReserve =
    out > 0 ? Math.min(out, MAX_OUTPUT_RESERVE_TOKENS) : FALLBACK_OUTPUT_RESERVE_TOKENS
  return REQUEST_OVERHEAD_TOKENS + outputReserve
}


/**
 * Check if there is enough spare output room for a generation.
 * Returns true if `limit - used >= outputReserve` (typically 32k).
 * Used as a pre-flight gate before `llm.stream()` — if false, compact first.
 */
export function hasSpareOutput(input: {
  cfg: Config.Info
  model: Provider.Model
  used: number  // full request estimate (content/4 + REQUEST_OVERHEAD_TOKENS)
}): boolean {
  const observedLimit = TokenCalibration.getObservedLimit(input.model)
  const limit = observedLimit ?? input.model.limit.input ?? input.model.limit.context
  if (limit <= 0) return true  // unknown limit — never block
  const outputReserve = input.model.limit.output ?? 0
  const reserve = outputReserve > 0 ? Math.min(outputReserve, MAX_OUTPUT_RESERVE_TOKENS) : FALLBACK_OUTPUT_RESERVE_TOKENS
  return limit - input.used >= reserve
}

export function usable(input: { cfg: Config.Info; model: Provider.Model }) {
  const context = input.model.limit.context
  if (context === 0) return 0

  // Prefer observed context limit from provider error messages over model definition
  const observedLimit = TokenCalibration.getObservedLimit(input.model)
  const limit = observedLimit ?? input.model.limit.input ?? context
  const reserved = input.cfg.compaction?.reserved ?? defaultUsableReserved(input.model)
  return Math.max(0, limit - reserved)
}

export function isOverflow(input: { cfg: Config.Info; tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false

  const count =
    input.tokens.total || input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write
  return count >= usable(input)
}

/** Pure content tokens from symbol count — no overhead, no tokenizer. */
export function contentTokensFromSymbols(symbols: number): number {
  if (symbols <= 0) return 0
  return Math.ceil(symbols / CHARS_PER_TOKEN)
}

/**
 * Full request size for safety / context-fit decisions:
 * `contentTokens + REQUEST_OVERHEAD_TOKENS`. Tokenizer is not used — it
 * undercounts across providers relative to this empirical formula.
 */
export function estimateRequestTokens(contentTokens: number): number {
  if (contentTokens <= 0) return 0
  return contentTokens + REQUEST_OVERHEAD_TOKENS
}

/**
 * Hard floor: the summary response must always have this much generation room
 * under the provider limit — otherwise the provider cuts input content.
 */
export const SUMMARY_GENERATION_RESERVE_TOKENS = 32_768

/**
 * True when the full-M summary request + the 32K generation reserve would
 * exceed the provider limit. Compaction MUST fire before the summary in that
 * case (user invariant: always ≥32K room for generation, never risk truncated
 * content). Unknown limits (≤0) never block.
 */
export function summaryNeedsCompactFirst(input: { model: Provider.Model; contentTokens: number }): boolean {
  const limit =
    TokenCalibration.getObservedLimit(input.model) ?? input.model.limit.input ?? input.model.limit.context
  if (limit <= 0) return false
  return estimateRequestTokens(input.contentTokens) + SUMMARY_GENERATION_RESERVE_TOKENS > limit
}

/**
 * Content-only tokens from message parts (chars/4).
 * No tokenizer, no +10k. For cadence callers use
 * `SessionCompaction.computeOpenWindowTokens` instead.
 * `model` retained for call-site compatibility (calibration hooks later).
 *
 * Media is NOT counted as text (2026-09-07, Alexander): providers bill
 * video/images by duration/dimensions, not payload bytes — counting the
 * 2.7M-char base64 of a 1.97 MiB clip as text produced ~688K phantom tokens
 * and an emergency compaction that silently dropped the video. The real
 * media cost is measured per-model from provider usage responses
 * (see media-token-calibration.ts); when a measurement exists it can be
 * added via `estimateMediaTokens`, never via chars/4.
 */
export function estimateContentTokens(msgs: MessageV2.WithParts[], _model: Provider.Model): number {
  let chars = 0
  for (const msg of msgs) {
    for (const part of msg.parts) {
      if (part.type === "text" && !part.ignored) {
        chars += part.text.length
      } else if (part.type === "reasoning") {
        chars += part.text.length
      } else if (part.type === "tool" && part.state.status === "completed") {
        // Tool output text counts; attachments (media/data URLs) do NOT —
        // they are billed by the provider per duration/dimensions, not bytes.
        chars += part.state.output.length
      }
    }
  }
  return contentTokensFromSymbols(chars)
}

/**
 * Provider-calibrated estimate for media items in the message list:
 * per-model EMA of measured provider tokens per media item, gated by model
 * modality support (media-token-calibration.ts). Returns 0 without a
 * measurement — no heuristics for media, by design.
 */
export function estimateMediaTokens(msgs: MessageV2.WithParts[], model: Provider.Model): number {
  let video = 0
  let image = 0
  for (const msg of msgs) {
    for (const part of msg.parts) {
      if (part.type !== "file") continue
      if (part.mime.startsWith("video/")) video++
      else if (part.mime.startsWith("image/")) image++
    }
  }
  let total = 0
  if (video > 0) total += MediaTokenCalibration.estimate({ model, modality: "video", count: video })
  if (image > 0) total += MediaTokenCalibration.estimate({ model, modality: "image", count: image })
  return total
}

/**
 * Hard **context-safety** heuristic (usable window + output room).
 * Uses `content/4 + 10k` request estimate — not tokenizer.
 * Do **not** use for Layer-2 cadence — `compact()` costs **zero** LLM tokens
 * and must fire on open-window content via {@link needsContentCompaction}.
 */
export function isOverflowFromContent(input: {
  cfg: Config.Info
  msgs: MessageV2.WithParts[]
  model: Provider.Model
}) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false
  if (input.msgs.length === 0) return false

  // Text via chars/4 + media via the per-model provider-calibrated EMA
  // (0 until a measurement exists — no heuristics for media).
  const content =
    estimateContentTokens(input.msgs, input.model) + estimateMediaTokens(input.msgs, input.model)
  const count = estimateRequestTokens(content)
  const output = ProviderTransform.maxOutputTokens(input.model, undefined, count)
  return count >= usable(input) || count + output >= input.model.limit.context
}

/**
 * Mechanistic Layer-2 compact **gate** (zero LLM tokens — pure fold to m*).
 *
 * Callers pass **full visible** content tokens (chars/4) and a **model-sized**
 * target — typically `usable({ cfg, model })` — **not** Layer-1's 65_536.
 * Layer-1 sidecar cadence is separate (`SUMMARY_INTERVAL_TOKENS` / open window).
 *
 * Avoids importing compaction.ts (cycle: compaction → overflow).
 */
export function needsContentCompaction(input: {
  cfg: Config.Info
  /** Full visible content tokens (chars/4) for Layer-2; not open-since-s. */
  openTokens: number
  /**
   * Fold threshold. Layer-2 must pass `usable(model)` (or similar model room).
   * Do **not** pass SUMMARY_INTERVAL_TOKENS (65k) — that is Layer-1 s only.
   */
  target: number
}) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.openTokens <= 0) return false
  const target = Math.max(1, input.target)
  return input.openTokens >= target
}

// ===== FILE: packages/opencode/src/session/token-calibration.ts =====
/**
 * Token Calibration — self-correcting token estimates from provider ground truth.
 *
 * When a provider returns a context overflow error, the error message often
 * contains the actual token count or context limit. We parse these numbers
 * and compute a correction factor to improve future token estimates.
 *
 * Correction is smoothed: 70% old factor + 30% new observation, so a single
 * outlier doesn't skew estimates.
 */
import type { Provider } from "@/provider/provider"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "token-calibration" })

interface CalibrationEntry {
  /** Multiplicative correction: provider_count / our_estimate */
  factor: number
  /** Observed context limit from provider error (may differ from config) */
  observedLimit?: number
  /** When this calibration was last updated */
  updatedAt: number
}

const corrections = new Map<string, CalibrationEntry>()

function modelKey(model: Provider.Model): string {
  return `${model.providerID}:${model.id}`
}

/** Update calibration from a provider overflow error. */
export function update(
  model: Provider.Model,
  info: { contextLimit?: number; inputTokens?: number },
  ourEstimate?: number,
): void {
  const k = modelKey(model)
  const existing = corrections.get(k) ?? { factor: 1, updatedAt: 0 }

  if (info.contextLimit) {
    existing.observedLimit = info.contextLimit
    log.info("observed context limit from provider", {
      model: model.id,
      providerLimit: info.contextLimit,
      configLimit: model.limit.context,
    })
  }

  if (info.inputTokens && ourEstimate && ourEstimate > 0) {
    const newFactor = info.inputTokens / ourEstimate
    // Smooth: blend old factor (70%) with new observation (30%)
    // First observation uses the value directly
    existing.factor = existing.factor === 1
      ? newFactor
      : existing.factor * 0.7 + newFactor * 0.3
    log.info("token calibration updated", {
      model: model.id,
      factor: existing.factor.toFixed(3),
      providerCount: info.inputTokens,
      ourEstimate,
    })
  }

  existing.updatedAt = Date.now()
  corrections.set(k, existing)
}

/** Get the correction factor for a model (default 1.0). */
export function getFactor(model: Provider.Model): number {
  return corrections.get(modelKey(model))?.factor ?? 1
}

/** Get the observed context limit from a previous provider error. */
export function getObservedLimit(model: Provider.Model): number | undefined {
  return corrections.get(modelKey(model))?.observedLimit
}

export * as TokenCalibration from "./token-calibration"

// ===== FILE: packages/opencode/src/session/media-token-calibration.ts =====
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
