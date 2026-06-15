import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { Token } from "@/util/token"
import { Tokenizers } from "@/tokenizers/index"
import type { MessageV2 } from "./message-v2"

const COMPACTION_BUFFER = 20_000

export function usable(input: { cfg: Config.Info; model: Provider.Model }) {
  const context = input.model.limit.context
  if (context === 0) return 0

  const limit = input.model.limit.input ?? context
  const reserved = input.cfg.compaction?.reserved ?? Math.min(COMPACTION_BUFFER, Math.floor(limit * 0.15))
  return Math.max(0, limit - reserved)
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
function estimateContentTokens(msgs: MessageV2.WithParts[], model: Provider.Model): number {
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

  // Prefer real tokenizer for exact count (resolves via api.id → name → family)
  const tok = Tokenizers.getTokenizerSync(model)
  if (tok) {
    return tok.countTokens(fragments.join("\n"))
  }

  // Fallback: chars/4 heuristic
  return Math.ceil(chars / 4)
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
