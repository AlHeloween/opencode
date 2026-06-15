import type { TokenizerConfig } from "./types"

/**
 * Built-in model → tokenizer mappings.
 *
 * Exact matches are checked first, then wildcard patterns (keys containing "*")
 * are matched via regex against the model.api.id field.
 */
export const BUILTIN_TOKENIZERS: Record<string, TokenizerConfig> = {
  // ── DeepSeek V4 ──────────────────────────────────────────────────
  "deepseek-v4-pro": {
    source: "bundled",
    path: "deepseek-v4",
    type: "bpe",
  },
  "deepseek-v4-flash": {
    source: "bundled",
    path: "deepseek-v4",
    type: "bpe",
  },
  "*deepseek-v4*": {
    source: "bundled",
    path: "deepseek-v4",
    type: "bpe",
  },

  // ── Qwen3 (all variants share the same tokenizer) ─────────────────
  "kat-coder-pro-v2": {
    source: "bundled",
    path: "qwen3",
    type: "bpe",
  },
  // kwaipilot/kat-coder-pro-v2 is Qwen3-based
  "kwaipilot/kat-coder-pro-v2": {
    source: "bundled",
    path: "qwen3",
    type: "bpe",
  },
  "*kat-coder*": {
    source: "bundled",
    path: "qwen3",
    type: "bpe",
  },
  "*qwen3*": {
    source: "bundled",
    path: "qwen3",
    type: "bpe",
  },
  "*Qwen3*": {
    source: "bundled",
    path: "qwen3",
    type: "bpe",
  },

  // ── GPT-5 (OpenAI o200k_base tokenizer via tiktoken) ──────────────
  "gpt-5": {
    source: "tiktoken",
    path: "o200k_base",
    type: "openai",
  },
  "*gpt-5*": {
    source: "tiktoken",
    path: "o200k_base",
    type: "openai",
  },
  // GPT-4o also uses o200k_base
  "*gpt-4o*": {
    source: "tiktoken",
    path: "o200k_base",
    type: "openai",
  },
  // GPT-4 / GPT-3.5 use cl100k_base
  "*gpt-4*": {
    source: "tiktoken",
    path: "cl100k_base",
    type: "openai",
  },
  "*gpt-3.5*": {
    source: "tiktoken",
    path: "cl100k_base",
    type: "openai",
  },
}

/**
 * Resolve the tokenizer config for a model ID (model.api.id).
 * Checks exact matches first, then wildcard patterns in insertion order.
 */
export function resolveTokenizer(modelId: string): TokenizerConfig | undefined {
  // Exact match
  if (BUILTIN_TOKENIZERS[modelId]) {
    return BUILTIN_TOKENIZERS[modelId]
  }
  // Wildcard patterns
  for (const [pattern, config] of Object.entries(BUILTIN_TOKENIZERS)) {
    if (pattern.includes("*")) {
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$", "i")
      if (regex.test(modelId)) {
        return config
      }
    }
  }
  return undefined
}

export * as TokenizerRegistry from "./registry"
