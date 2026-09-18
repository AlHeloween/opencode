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
 * The image-token curve, MEASURED against the live API (2026-09-12,
 * `deepseek-flash`): one identical question on a growing square canvas, image
 * cost isolated from the ~35-token request overhead. Raw sweep and table live in
 * `experiments_history/2026-09-12_deepseek-vision/`.
 *
 *   canvas    pixels     image tokens
 *    512²     262_144    187   ← floor: smaller canvases are upscaled to ~544²
 *    640²     409_600    277
 *    768²     589_824    385
 *   1024²   1_048_576    655
 *   1280²   1_638_400    997   ← cap reached
 *   2048²   4_194_304    997   ← and beyond: the server DOWNSCALES; you pay the
 *                                 maximum and lose sharpness (double penalty)
 *
 * Linear at 1 token / 1700 px with an intercept of 36, clamped at both ends:
 * `clamp(pixels / 1700 + 36, 187, 997)` reproduces every measured row within
 * ~0.4%.
 *
 * The SATURATION is the part a tile grid gets wrong, and it is why this is not a
 * `85 + 170 x tiles` shape: past 1280×1280 the price stops growing while the
 * image shrinks, so an area-linear estimate overcharges exactly where our own
 * 2000-px ingestion cap parks the pixels (2000² ⇒ cap 997, not ~2800).
 *
 * Read the numbers, not the experiment's prose: that page writes
 * `pixels / 1700 + 187`, but 187 is the FLOOR — the plateau value for small
 * canvases — not the intercept. With 187 as the intercept the curve misses its
 * own table by 15-23% (1024² ⇒ 804 predicted against 655 measured), while the
 * sweep data and the `PAGE-LIMITS.md` table independently agree on 36.
 *
 * Scope: measured on DeepSeek's vision path. A per-model measurement overrides
 * it (see `estimateMediaTokens`); for any other vision provider this curve is a
 * stated approximation, not a claim.
 */
const IMAGE_PIXELS_PER_TOKEN = 1700
const IMAGE_INTERCEPT_TOKENS = 36
const IMAGE_FLOOR_TOKENS = 187
const IMAGE_CAP_TOKENS = 997

/**
 * Price an image from its PIXEL DIMENSIONS (owner ruling 2026-09-18).
 *
 * Bytes are never the price: counting a 2.7M-char base64 blob as text produced
 * ~688K phantom tokens and an emergency compaction that silently dropped the
 * video (measured 2026-09-07). The dimensions are stamped onto the part at
 * ingestion — in the same sharp pass that encodes the WebP — so pricing here
 * costs no extra decode.
 */
export function imageTokensFromDimensions(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 0
  const linear = Math.round((width * height) / IMAGE_PIXELS_PER_TOKEN) + IMAGE_INTERCEPT_TOKENS
  return Math.min(IMAGE_CAP_TOKENS, Math.max(IMAGE_FLOOR_TOKENS, linear))
}

/**
 * Media price for the window budget: the MEASURED per-model EMA wherever it
 * exists, the dimensional formula only as the floor beneath it.
 *
 * Measured-first is not a preference — `media_token_calibration` is the real
 * invoice. But it is EMPTY for every model we talk to: our providers never send
 * `prompt_tokens_details.image_tokens`, so `record` (`processor.ts:1135`) never
 * fires (measured 2026-09-18: 0 rows against 51 images in history). A
 * measurement-only price therefore means images are FREE and a thousand
 * screenshots raise no signal. The formula covers exactly that gap, and is
 * overridden the moment a real measurement appears.
 *
 * Gated by modality support on both paths: a model that cannot take images does
 * not receive them on the wire (they leave as text), so pricing them would
 * invent cost for bytes that are never sent.
 *
 * Video/audio stay 0 until measured — no dimensions are known for them, and
 * guessing from duration is exactly the phantom-token class this rule forbids.
 */
export function estimateMediaTokens(msgs: MessageV2.WithParts[], model: Provider.Model): number {
  let video = 0
  let image = 0
  let byDimensions = 0
  for (const msg of msgs) {
    for (const part of msg.parts) {
      if (part.type !== "file") continue
      if (part.mime.startsWith("video/")) {
        video++
        continue
      }
      if (!part.mime.startsWith("image/")) continue
      image++
      if (part.dimensions) byDimensions += imageTokensFromDimensions(part.dimensions.width, part.dimensions.height)
    }
  }
  if (video === 0 && image === 0) return 0
  let total = 0
  if (video > 0) total += MediaTokenCalibration.estimate({ model, modality: "video", count: video })
  if (image > 0) {
    const measured = MediaTokenCalibration.estimate({ model, modality: "image", count: image })
    if (measured > 0) total += measured
    else if (MediaTokenCalibration.modelSupports(model, "image")) total += byDimensions
  }
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
