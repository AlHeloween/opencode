import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { Tokenizers } from "@/tokenizers/index"
import type { MessageV2 } from "./message-v2"
import { TokenCalibration } from "./token-calibration"

const COMPACTION_BUFFER = 20_000
const SUMMARY_REQUEST_HEADROOM_TOKENS = 2_048

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

/** Extract text content from message parts and count tokens.
  * Uses the real BPE tokenizer if available for the model;
  * falls back to chars/4 heuristic otherwise. */
export function estimateContentTokens(msgs: MessageV2.WithParts[], model: Provider.Model): number {
  // Collect actual text fragments from content-bearing parts
  const fragments: string[] = []
  let chars = 0
  for (const msg of msgs) {
    for (const part of msg.parts) {
      if (part.type === "text" && !part.ignored) {
        fragments.push(part.text)
        chars += part.text.length
      } else if (part.type === "reasoning") {
        fragments.push(part.text)
        chars += part.text.length
      } else if (part.type === "tool" && part.state.status === "completed") {
        fragments.push(part.state.output)
        chars += part.state.output.length
      }
      // CompactionPart, SubtaskPart, StepStartPart, StepFinishPart, AgentPart,
      // RetryPart, SnapshotPart, PatchPart are lightweight metadata — skip.
    }
  }

  if (chars === 0) return 0

  const charsEstimate = Math.ceil(chars / 4)

  // Prefer real tokenizer for exact count (resolves via api.id → name → family)
  const tok = Tokenizers.getTokenizerSync(model)
  const tokEstimate = tok ? tok.countTokens(fragments.join("\n")) : 0

  // Use max(tokenizer, chars/4) — tokenizer may undercount for some models,
  // chars/4 slightly overcounts for real conversation data (safe side).
  const raw = Math.max(tokEstimate, charsEstimate)

  // Apply provider-calibrated correction factor (default 1.0)
  return Math.ceil(raw * TokenCalibration.getFactor(model))
}

/** Estimate overflow from extracted text content rather than stored token
  * fields or raw JSON. The text-based estimate avoids the 3-5x inflation
  * from JSON structural overhead (field names, brackets, quoting, escaping)
  * that causes premature compaction on large-context models. */
export function isOverflowFromContent(input: {
  cfg: Config.Info
  msgs: MessageV2.WithParts[]
  model: Provider.Model
}) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false
  if (input.msgs.length === 0) return false

  const count = estimateContentTokens(input.msgs, input.model)
  const output = ProviderTransform.maxOutputTokens(input.model, undefined, count)
  return count >= usable(input) || count + output >= input.model.limit.context
}
