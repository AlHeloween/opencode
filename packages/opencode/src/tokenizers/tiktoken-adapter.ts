import type { TokenizerInstance, TokenizerModel } from "./types"

/**
 * Adapter that wraps tiktoken for GPT-5 (o200k_base) and other OpenAI models.
 *
 * tiktoken is an optional dependency — install with `bun add tiktoken`.
 * If not installed, load/openaiTokenizer return undefined.
 */

let tiktokenModule: typeof import("tiktoken") | undefined

async function loadTiktoken(): Promise<typeof import("tiktoken") | undefined> {
  if (tiktokenModule) return tiktokenModule
  try {
    tiktokenModule = await import("tiktoken")
    return tiktokenModule
  } catch {
    return undefined
  }
}

type TiktokenEncoding = import("tiktoken").Tiktoken

/**
 * Wraps tiktoken.get_encoding() as a TokenizerInstance.
 */
class TiktokenTokenizer implements TokenizerInstance {
  readonly model: TokenizerModel
  private encoding: TiktokenEncoding

  constructor(encoding: TiktokenEncoding) {
    this.encoding = encoding
    this.model = {
      vocab: {},
      merges: {},
      specialTokens: {},
      vocabSize: 0,
    }
  }

  countTokens(text: string): number {
    const encoded = this.encoding.encode(text)
    return Array.from(encoded).length
  }

  encode(text: string): number[] {
    return Array.from(this.encoding.encode(text)) as number[]
  }

  decode(ids: number[]): string {
    const buf = new Uint32Array(ids)
    const decoded = this.encoding.decode(buf)
    return new TextDecoder().decode(decoded)
  }
}

const encodingCache = new Map<string, TiktokenTokenizer>()

/**
 * Get a tiktoken tokenizer for the given encoding name.
 * Encoding names: "o200k_base" (GPT-4o/GPT-5), "cl100k_base" (GPT-4/3.5), "p50k_base" (GPT-3)
 */
export async function openaiTokenizer(encodingName: string): Promise<TiktokenTokenizer | undefined> {
  const cached = encodingCache.get(encodingName)
  if (cached) return cached

  const tiktoken = await loadTiktoken()
  if (!tiktoken) return undefined

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enc = (tiktoken as any).get_encoding(encodingName) as TiktokenEncoding
    const tok = new TiktokenTokenizer(enc)
    encodingCache.set(encodingName, tok)
    return tok
  } catch {
    return undefined
  }
}

/** Synchronous accessor — returns undefined if not yet loaded */
export function getOpenaiTokenizer(encodingName: string): TiktokenTokenizer | undefined {
  return encodingCache.get(encodingName)
}

export { TiktokenTokenizer }
export * as TiktokenAdapter from "./tiktoken-adapter"
