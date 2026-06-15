import type { Provider } from "@/provider/provider"
import type { TokenizerInstance } from "./types"
import type { TokenizerConfig } from "./types"
import { resolveTokenizer } from "./registry"
import { loadDeepSeekV4, getDeepSeekV4 } from "./deepseek-v4/loader"
import { loadQwen3, getQwen3 } from "./qwen3/loader"
import { openaiTokenizer, getOpenaiTokenizer } from "./tiktoken-adapter"
import { Token } from "@/util/token"

/**
 * Resolve tokenizer config for a model, trying multiple identification fields.
 * Order: api.id → name → family. First match wins.
 */
function resolveConfig(model: Provider.Model): TokenizerConfig | undefined {
  // Try api.id first (most specific: e.g. "deepseek-v4-pro", "kwaipilot/kat-coder-pro-v2")
  let config = resolveTokenizer(model.api.id)
  if (config) return config
  // Fall back to model name (e.g. "kat-coder-pro-v2 (OpenAI 3)" matches *kat-coder*)
  config = resolveTokenizer(model.name)
  if (config) return config
  // Last resort: model family (e.g. "kat-coder", "qwen3-coder")
  if (model.family) {
    config = resolveTokenizer(model.family)
    if (config) return config
  }
  return undefined
}

/** Load a tokenizer from its config */
async function loadFromConfig(config: TokenizerConfig): Promise<TokenizerInstance | undefined> {
  if (config.type === "bpe") {
    if (config.path === "deepseek-v4") return loadDeepSeekV4()
    if (config.path === "qwen3") return loadQwen3()
    return undefined
  }
  if (config.type === "openai" && config.path) {
    return openaiTokenizer(config.path)
  }
  return undefined
}

/** Synchronous tokenizer lookup from config */
function getFromConfig(config: TokenizerConfig): TokenizerInstance | undefined {
  if (config.type === "bpe") {
    if (config.path === "deepseek-v4") return getDeepSeekV4()
    if (config.path === "qwen3") return getQwen3()
    return undefined
  }
  if (config.type === "openai" && config.path) {
    return getOpenaiTokenizer(config.path)
  }
  return undefined
}

/**
 * Get the tokenizer instance for a model.
 * Resolves via api.id → name → family. Returns undefined if no match or loading fails.
 */
export async function getTokenizer(model: Provider.Model): Promise<TokenizerInstance | undefined> {
  const config = resolveConfig(model)
  if (!config) return undefined
  return loadFromConfig(config)
}

/** Synchronous accessor — returns undefined if not yet loaded */
export function getTokenizerSync(model: Provider.Model): TokenizerInstance | undefined {
  const config = resolveConfig(model)
  if (!config) return undefined
  return getFromConfig(config)
}

/**
 * Count tokens in text for a given model.
 * Uses the real tokenizer if available, falls back to chars/4 heuristic.
 */
export async function countTokens(model: Provider.Model, text: string): Promise<number> {
  const tok = await getTokenizer(model)
  if (tok) return tok.countTokens(text)
  return Token.estimate(text)
}

/**
 * Synchronous token count — uses loaded tokenizer or falls back to /4.
 */
export function countTokensSync(model: Provider.Model, text: string): number {
  const tok = getTokenizerSync(model)
  if (tok) return tok.countTokens(text)
  return Token.estimate(text)
}

/** Pre-load all tokenizers during initialization */
export async function preload(): Promise<void> {
  await Promise.all([
    loadDeepSeekV4(),
    loadQwen3(),
  ])
}

export * as Tokenizers from "./index"
