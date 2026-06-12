import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
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

/** Estimate overflow from actual message content, not stored token fields.
  * Avoids synthetic-zero-token blind spot from compaction tail copies. */
export function isOverflowFromContent(input: {
  cfg: Config.Info
  msgs: MessageV2.WithParts[]
  model: Provider.Model
}) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false
  if (input.msgs.length === 0) return false

  const count = Math.ceil(JSON.stringify(input.msgs).length / 4)
  const output = ProviderTransform.maxOutputTokens(input.model, undefined, count)
  return count >= usable(input) || count + output >= input.model.limit.context
}
