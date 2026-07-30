import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import type { MessageV2 } from "./message-v2"
import { TokenCalibration } from "./token-calibration"

const COMPACTION_BUFFER = 20_000
const SUMMARY_REQUEST_HEADROOM_TOKENS = 2_048

/** Content body heuristic: ~1 token per 4 symbols (chars). Cadence uses this alone. */
export const CHARS_PER_TOKEN = 4

/**
 * Empirical full-request overhead (system prefix, tools schema, framing).
 * Validated across providers/windows: tokenizers systematically undercount the
 * real request; `content/4 + 10_000` tracks provider limits better.
 * Used only on **safety / fit** paths — never on Layer-1/2 open-window cadence.
 */
export const REQUEST_OVERHEAD_TOKENS = 10_000

function summaryResponseBudget(model: Provider.Model, contentTokens: number) {
  const raw = ProviderTransform.maxOutputTokens(model, undefined, contentTokens)
  if (!model.capabilities.reasoning) return raw
  // Keep this aligned with LLM.stream(): reasoning consumes the same output
  // budget as visible text. OpenAI reasoning requests omit the cap, so reserve
  // the model's declared output maximum as the conservative upper bound.
  return Math.min(raw * 3, model.limit.output || raw * 3)
}

export function usable(input: { cfg: Config.Info; model: Provider.Model }) {
  const context = input.model.limit.context
  if (context === 0) return 0

  // Prefer observed context limit from provider error messages over model definition
  const observedLimit = TokenCalibration.getObservedLimit(input.model)
  const limit = observedLimit ?? input.model.limit.input ?? context
  const reserved = input.cfg.compaction?.reserved ?? Math.min(COMPACTION_BUFFER, Math.floor(limit * 0.15))
  return Math.max(0, limit - reserved)
}

/**
 * Normal Layer-1 cadence may be larger than a provider's usable context.
 * Reserve room for the synthetic summary request and its response so a
 * completed normal turn can transition into a summary without first looping
 * through another overflow compaction.
 */
export function summaryWindowLimit(input: { cfg: Config.Info; model: Provider.Model; target: number }) {
  if (input.model.limit.context === 0) return input.target
  return Math.max(
    1,
    Math.min(
      input.target,
      usable(input) -
        summaryResponseBudget(input.model, input.target) -
        SUMMARY_REQUEST_HEADROOM_TOKENS,
    ),
  )
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
 * Content-only tokens from message parts (chars/4).
 * No tokenizer, no +10k. For cadence callers use
 * `SessionCompaction.computeOpenWindowTokens` instead.
 * `model` retained for call-site compatibility (calibration hooks later).
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
        chars += part.state.output.length
      }
    }
  }
  return contentTokensFromSymbols(chars)
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

  const content = estimateContentTokens(input.msgs, input.model)
  const count = estimateRequestTokens(content)
  const output = ProviderTransform.maxOutputTokens(input.model, undefined, count)
  return count >= usable(input) || count + output >= input.model.limit.context
}

/**
 * Mechanistic Layer-2 / in-band compaction **cadence** gate.
 *
 * `compact()` reorganizes existing sidecars/summaries into `message*` — it does
 * **not** call the provider. Therefore this gate must **not** use `usable()`,
 * `isOverflowFromContent`, or `summaryWindowLimit` (those reserve LLM headroom
 * for normal turns / Layer-1 sidecar).
 *
 * Callers pass open-window tokens from
 * `SessionCompaction.computeOpenWindowTokens` (sidecar boundary when present).
 * Avoids importing compaction.ts (cycle: compaction → overflow).
 */
export function needsContentCompaction(input: {
  cfg: Config.Info
  /** Open-window content tokens (chars/4) since last Layer-1 boundary. */
  openTokens: number
  /** Normal cadence target, typically SUMMARY_INTERVAL_TOKENS (65_536). */
  target: number
}) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.openTokens <= 0) return false
  const target = Math.max(1, input.target)
  return input.openTokens >= target
}
