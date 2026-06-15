export interface TokenizerModel {
  /** token string → token ID (e.g. "hello" → 12345) */
  vocab: Record<string, number>
  /** "tokA tokB" → merge rank (lower = higher priority) */
  merges: Record<string, number>
  /** Special token string → token ID */
  specialTokens: Record<string, number>
  /** Maximum token ID */
  vocabSize: number
  /** Regex pattern for pre-tokenization (Split step). Falls back to GPT-2 default. */
  preTokenizerPattern?: string
}

export interface TokenizerConfig {
  /** Source of the tokenizer model */
  source: "bundled" | "huggingface" | "tiktoken"
  /** HuggingFace repo ID (for source: "huggingface") */
  repo?: string
  /** Path to bundled model JSON (for source: "bundled") or tiktoken encoding name */
  path?: string
  /** Tokenizer implementation class/module */
  type: "bpe" | "openai" | "custom"
}

export interface TokenizerInstance {
  /** Count tokens in text */
  countTokens(text: string): number
  /** Encode text to token IDs */
  encode(text: string): number[]
  /** Decode token IDs back to text */
  decode(ids: number[]): string
  /** The raw model data */
  model: TokenizerModel
}

export * as TokenizerTypes from "./types"
