import type { TokenizerModel, TokenizerInstance } from "./types"

/**
 * Byte-level BPE encoder — produces exact token counts matching
 * HuggingFace PreTrainedTokenizerFast (BPE model type).
 *
 * Algorithm:
 * 1. Pre-tokenize: split text by GPT-2 regex pattern
 * 2. Byte-level encode: each byte → unicode char in range U+0100+
 * 3. Apply BPE merges: iteratively merge lowest-ranked adjacent pair
 * 4. Look up each subword in vocab → token ID
 */
export class BPETokenizer implements TokenizerInstance {
  readonly model: TokenizerModel
  private vocab: Map<string, number>
  private merges: Map<string, number>
  private reverseVocab: Map<number, string>
  private pretokRegex: RegExp
  /** LRU cache: word → encoded token IDs */
  private cache: Map<string, number[]>

  constructor(model: TokenizerModel) {
    this.model = model
    this.vocab = new Map(Object.entries(model.vocab))
    this.merges = new Map(Object.entries(model.merges))
    this.reverseVocab = new Map()
    for (const [token, id] of this.vocab) {
      this.reverseVocab.set(id, token)
    }
    this.cache = new Map()
    // Use model-specific pre-tokenizer pattern, fall back to GPT-2 default
    this.pretokRegex = model.preTokenizerPattern
      ? new RegExp(model.preTokenizerPattern, "gu")
      : PRETOKENIZER_PATTERN
  }

  countTokens(text: string): number {
    return this.encode(text).length
  }

  encode(text: string): number[] {
    const tokens: number[] = []
    const words = pretokenize(text, this.pretokRegex)

    for (const word of words) {
      const cached = this.cache.get(word)
      if (cached) {
        tokens.push(...cached)
        continue
      }

      // 1. Convert word to byte-level characters
      const byteChars = bytesToUnicode(word)

      // 2. Apply BPE merges
      const merged = this.bpe(byteChars)

      // 3. Map to token IDs
      const ids = merged.map((token) => {
        const id = this.vocab.get(token)
        if (id !== undefined) return id
        // Fallback: unknown token → split into byte-level chars and return their IDs
        const fallbackIds: number[] = []
        for (const char of token) {
          const charId = this.vocab.get(char)
          if (charId !== undefined) fallbackIds.push(charId)
        }
        return fallbackIds.length > 0 ? fallbackIds[0] : 0 // last resort: BOS
      }).flat()

      this.cache.set(word, ids)
      tokens.push(...ids)
    }

    return tokens
  }

  decode(ids: number[]): string {
    const tokens = ids.map((id) => this.reverseVocab.get(id) ?? "")
    const text = tokens.join("")
    // Convert byte-level unicode chars back to bytes, then to UTF-8 string
    return unicodeToBytes(text)
  }

  /** Core BPE merge algorithm for a single word (already byte-encoded) */
  private bpe(byteChars: string[]): string[] {
    if (byteChars.length <= 1) return byteChars

    let tokens = [...byteChars]

    // eslint-disable-next-line no-constant-condition
    while (true) {
      let bestRank = Infinity
      let bestIdx = -1

      for (let i = 0; i < tokens.length - 1; i++) {
        const pair = tokens[i] + " " + tokens[i + 1]
        const rank = this.merges.get(pair)
        if (rank !== undefined && rank < bestRank) {
          bestRank = rank
          bestIdx = i
        }
      }

      if (bestIdx === -1) break

      const merged = tokens[bestIdx] + tokens[bestIdx + 1]
      tokens.splice(bestIdx, 2, merged)
    }

    return tokens
  }
}

// ── Pre-tokenization ──────────────────────────────────────────────────────
// GPT-2 regex pattern matching HuggingFace ByteLevel pre-tokenizer
const PRETOKENIZER_PATTERN =
  /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu

function pretokenize(text: string, pattern: RegExp = PRETOKENIZER_PATTERN): string[] {
  const matches = text.match(pattern)
  return matches ?? (text.length > 0 ? [text] : [])
}

// ── Byte ↔ Unicode mapping ────────────────────────────────────────────────
// Maps bytes 0-255 to printable unicode characters (GPT-2 style)
// Bytes 33-126 (printable ASCII) map to themselves
// Other bytes map to U+0100+

function bytesToUnicodeMap(): Map<number, string> {
  const map = new Map<number, string>()
  // Printable ASCII range (33 '!' through 126 '~') maps to itself
  let next = 0
  for (let b = 33; b <= 126; b++) {
    map.set(b, String.fromCodePoint(b))
  }
  // Everything else maps to U+0100+
  next = 256
  for (let b = 0; b < 256; b++) {
    if (!map.has(b)) {
      map.set(b, String.fromCodePoint(next))
      next++
    }
  }
  return map
}

// Lazy-initialized
let _byteToUnicode: Map<number, string> | undefined
let _unicodeToByte: Map<string, number> | undefined

function getByteToUnicode(): Map<number, string> {
  if (!_byteToUnicode) {
    _byteToUnicode = bytesToUnicodeMap()
  }
  return _byteToUnicode
}

function getUnicodeToByte(): Map<string, number> {
  if (!_unicodeToByte) {
    _unicodeToByte = new Map()
    for (const [byte, char] of getByteToUnicode()) {
      _unicodeToByte.set(char, byte)
    }
  }
  return _unicodeToByte
}

function bytesToUnicode(text: string): string[] {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(text)
  const byteToUni = getByteToUnicode()
  return Array.from(bytes, (b) => byteToUni.get(b) ?? String.fromCodePoint(b))
}

function unicodeToBytes(text: string): string {
  const uniToByte = getUnicodeToByte()
  const bytes: number[] = []
  for (const char of text) {
    const byte = uniToByte.get(char)
    bytes.push(byte ?? char.codePointAt(0) ?? 0)
  }
  const decoder = new TextDecoder()
  return decoder.decode(new Uint8Array(bytes))
}

export * as BPETokenizerMod from "./bpe-encoder"
