import { Lexer, type MarkedToken } from "marked"

export interface ParseState {
  content: string
  tokens: MarkedToken[]
  stableTokenCount?: number
}

/**
 * Full lexes of the same content, stored (T11b step 3). A finished message is a pure function of its text,
 * and remounting it — re-entering a session, loading an older page — re-lexed it from scratch: marked's
 * block `lex` was ~85 % of mount time (40 × 12 000-char messages, ~140 ms per mount). Tokens are read-only
 * downstream, so the stored array is returned as is. Insertion order is the LRU order; entries and total
 * characters are both bounded; short content is not worth an entry.
 */
const FULL_LEX_CACHE_MIN_CHARS = 512
const FULL_LEX_CACHE_MAX_ENTRIES = 256
const FULL_LEX_CACHE_MAX_CHARS = 2_000_000
const fullLexCache = new Map<string, MarkedToken[]>()
let fullLexCacheChars = 0

function lexWhole(content: string): MarkedToken[] {
  if (content.length < FULL_LEX_CACHE_MIN_CHARS) return Lexer.lex(content, { gfm: true }) as MarkedToken[]
  const stored = fullLexCache.get(content)
  if (stored) {
    fullLexCache.delete(content)
    fullLexCache.set(content, stored)
    return stored
  }
  const tokens = Lexer.lex(content, { gfm: true }) as MarkedToken[]
  fullLexCache.set(content, tokens)
  fullLexCacheChars += content.length
  while (fullLexCache.size > FULL_LEX_CACHE_MAX_ENTRIES || fullLexCacheChars > FULL_LEX_CACHE_MAX_CHARS) {
    const oldest = fullLexCache.keys().next().value!
    fullLexCache.delete(oldest)
    fullLexCacheChars -= oldest.length
  }
  return tokens
}

/**
 * Incrementally parse markdown, reusing unchanged tokens from previous parse.
 * Compares token.raw at each offset - matching tokens keep same object reference.
 */
export function parseMarkdownIncremental(
  newContent: string,
  prevState: ParseState | null,
  trailingUnstable: number = 2,
): ParseState {
  if (!prevState || prevState.tokens.length === 0) {
    try {
      const tokens = lexWhole(newContent)
      return {
        content: newContent,
        tokens,
        stableTokenCount: Math.max(0, tokens.length - trailingUnstable),
      }
    } catch (error) {
      console.warn("bug: markdown lex failed, rendering as plain text:", error)
      return { content: newContent, tokens: [], stableTokenCount: 0 }
    }
  }

  // Find how many tokens from start are unchanged
  let offset = 0
  let reuseCount = 0

  for (const token of prevState.tokens) {
    const tokenLength = token.raw.length
    if (offset + tokenLength <= newContent.length && newContent.startsWith(token.raw, offset)) {
      reuseCount++
      offset += tokenLength
    } else {
      break
    }
  }

  // Keep last N tokens unstable (e.g. "# Hello" might become "# Hello World")
  reuseCount = Math.max(0, reuseCount - trailingUnstable)

  offset = 0
  for (let i = 0; i < reuseCount; i++) {
    offset += prevState.tokens[i].raw.length
  }

  const stableTokens = prevState.tokens.slice(0, reuseCount)
  const remainingContent = newContent.slice(offset)

  if (!remainingContent) {
    return {
      content: newContent,
      tokens: stableTokens,
      stableTokenCount: stableTokens.length,
    }
  }

  try {
    const newTokens = Lexer.lex(remainingContent, { gfm: true }) as MarkedToken[]
    return {
      content: newContent,
      tokens: [...stableTokens, ...newTokens],
      stableTokenCount: trailingUnstable === 0 ? stableTokens.length + newTokens.length : stableTokens.length,
    }
  } catch (error) {
    console.warn("bug: incremental markdown lex failed, re-lexing the whole content:", error)
    try {
      const fullTokens = Lexer.lex(newContent, { gfm: true }) as MarkedToken[]
      return { content: newContent, tokens: fullTokens, stableTokenCount: 0 }
    } catch (fullError) {
      console.warn("bug: markdown lex failed, rendering as plain text:", fullError)
      return { content: newContent, tokens: [], stableTokenCount: 0 }
    }
  }
}
