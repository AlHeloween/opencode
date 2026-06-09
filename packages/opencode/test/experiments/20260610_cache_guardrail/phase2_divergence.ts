/**
 * Phase 2: Token-Level Prefix Divergence Detection
 *
 * Given two Request objects, computes exactly where the token-level prefix
 * diverges. This is the deterministic core of the cache guardrail.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface Request {
  system: string[]
  messages: Array<{ role: "user" | "assistant"; content: string }>
}

export interface Token {
  text: string
  index: number
  source: string // e.g. "system[0]", "user[3]", "assistant[1]"
}

export type DivergenceCause =
  | "identical"
  | "date_changed"
  | "system_prompt_changed"
  | "new_message_appended"
  | "message_modified"
  | "message_removed"
  | "section_reordered"
  | "part_modified"

export interface SectionMatch {
  section: string
  startToken: number
  endToken: number
  matched: boolean
  similarity?: number
}

export interface DivergenceReport {
  totalTokens: number
  commonTokens: number
  divergenceIndex: number
  divergenceCause: DivergenceCause
  expectedHitRatio: number
  sections: SectionMatch[]
}

// ── Tokenizer ───────────────────────────────────────────────────────────────

const DATE_PATTERN = /today'?s?\s*date\s*:?\s*/i
const DATE_VALUE_PATTERN = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s*\d{4}\b/i

/**
 * Simple whitespace tokenizer. For production, use DeepSeek's BPE tokenizer.
 * Tags each token with its source path for divergence classification.
 */
export function tokenize(request: Request): Token[] {
  const tokens: Token[] = []
  let index = 0

  // System messages
  for (let si = 0; si < request.system.length; si++) {
    const words = request.system[si].split(/\s+/).filter(Boolean)
    for (const word of words) {
      tokens.push({ text: word, index: index++, source: `system[${si}]` })
    }
  }

  // Conversation messages
  for (let mi = 0; mi < request.messages.length; mi++) {
    const msg = request.messages[mi]
    const words = msg.content.split(/\s+/).filter(Boolean)
    for (const word of words) {
      tokens.push({ text: word, index: index++, source: `${msg.role}[${mi}]` })
    }
  }

  return tokens
}

// ── LCP Computation ────────────────────────────────────────────────────────

/**
 * Compute Longest Common Prefix between two token arrays.
 * Returns the number of matching tokens and the divergence index.
 */
export function computeLCP(
  prev: Token[],
  next: Token[],
): { commonTokens: number; divergenceIndex: number } {
  const minLen = Math.min(prev.length, next.length)
  let i = 0
  for (; i < minLen; i++) {
    if (prev[i].text !== next[i].text) break
  }
  return { commonTokens: i, divergenceIndex: i }
}

// ── Divergence Classification ──────────────────────────────────────────────

/**
 * Classify WHY the prefix diverged by inspecting the divergence point tokens.
 */
export function classifyDivergence(
  prev: Request,
  next: Request,
  divergenceToken: Token | null,
  prevTokens: Token[],
  nextTokens: Token[],
): DivergenceCause {
  // No divergence at all
  if (!divergenceToken && nextTokens.length === prevTokens.length) return "identical"

  // One request is a complete prefix of the other — check message count
  if (!divergenceToken) {
    if (next.messages.length > prev.messages.length) return "new_message_appended"
    if (next.messages.length < prev.messages.length) return "message_removed"
    return "identical"
  }

  const source = divergenceToken.source

  // Date change: divergence in system[2] containing date patterns
  if (source.startsWith("system[2]")) {
    const sysMsg = next.system[2] ?? ""
    if (DATE_PATTERN.test(sysMsg) || DATE_VALUE_PATTERN.test(sysMsg)) {
      return "date_changed"
    }
    return "system_prompt_changed"
  }

  // System prompt change: divergence in system[0]
  if (source.startsWith("system[0]")) {
    return "system_prompt_changed"
  }

  // System content change (rules/instructions/env)
  if (source.startsWith("system[1]")) {
    return "system_prompt_changed"
  }

  // Message count changed (and divergence is within the overlap zone)
  if (prev.messages.length !== next.messages.length) {
    if (next.messages.length > prev.messages.length) {
      // Check if divergence happens because next has MORE messages
      // If divergence is at or beyond prev's last message, it's just extra content
      const prevMsgTokens = prevTokens.filter(
        (t) => t.source.startsWith("user") || t.source.startsWith("assistant")
      )
      if (divergenceToken.index >= prevMsgTokens.length) {
        return "new_message_appended"
      }
    }
    return "message_removed"
  }

  // Same message count, individual message diverged
  const sourceMatch = source.match(/\d+/)
  if (sourceMatch) {
    const msgIdx = parseInt(sourceMatch[0])
    if (msgIdx < prev.messages.length) {
      const prevContent = prev.messages[msgIdx].content
      const nextContent = next.messages[msgIdx].content
      // Check if sections were reordered (same content, different order)
      const prevSections = extractSectionHeaders(prevContent)
      const nextSections = extractSectionHeaders(nextContent)
      if (prevSections.length > 0 && nextSections.length > 0) {
        const sortedPrev = [...prevSections].sort()
        const sortedNext = [...nextSections].sort()
        if (sortedPrev.join("") === sortedNext.join("") && prevContent !== nextContent) {
          return "section_reordered"
        }
      }
    }
  }

  return "message_modified"
}

function extractSectionHeaders(content: string): string[] {
  const lines = content.split("\n")
  return lines
    .filter((line) => /^#{1,3}\s+/.test(line))
    .map((line) => line.replace(/^#{1,3}\s+/, "").trim())
}

// ── Section Analysis ───────────────────────────────────────────────────────

function analyzeSections(
  prevTokens: Token[],
  nextTokens: Token[],
  commonTokens: number,
): SectionMatch[] {
  const sections: SectionMatch[] = []

  let currentSection = ""
  let sectionStart = 0

  for (let i = 0; i < nextTokens.length; i++) {
    const source = nextTokens[i].source
    if (source !== currentSection) {
      // Push the PREVIOUS section
      if (currentSection) {
        const sectionEnd = i
        const matched = sectionStart + (sectionEnd - sectionStart) <= commonTokens
          ? sectionEnd <= commonTokens
          : false
        sections.push({
          section: currentSection,
          startToken: sectionStart,
          endToken: sectionEnd,
          matched,
        })
      }
      currentSection = source
      sectionStart = i
    }
  }

  // Push the LAST section
  if (currentSection) {
    const endToken = nextTokens.length
    const matched = commonTokens >= endToken
    sections.push({
      section: currentSection,
      startToken: sectionStart,
      endToken,
      matched,
    })
  }

  return sections
}

// ── Main Function ──────────────────────────────────────────────────────────

export function computeDivergence(
  prev: Request,
  next: Request,
): DivergenceReport {
  const prevTokens = tokenize(prev)
  const nextTokens = tokenize(next)

  const { commonTokens, divergenceIndex } = computeLCP(prevTokens, nextTokens)

  const divergenceToken = divergenceIndex < nextTokens.length
    ? nextTokens[divergenceIndex]
    : null

  const cause = classifyDivergence(prev, next, divergenceToken, prevTokens, nextTokens)
  const sections = analyzeSections(prevTokens, nextTokens, commonTokens)

  const totalTokens = nextTokens.length
  const hitRatio = totalTokens > 0
    ? commonTokens / totalTokens
    : cause === "identical" ? 1.0 : 0.0

  return {
    totalTokens,
    commonTokens,
    divergenceIndex,
    divergenceCause: cause,
    expectedHitRatio: Math.round(hitRatio * 100) / 100,
    sections,
  }
}

// ── Self-test ──────────────────────────────────────────────────────────────

if (import.meta.main) {
  // Quick smoke test
  const prev: Request = {
    system: ["You are an assistant", "Be helpful", "Today's date: June 9, 2026"],
    messages: [
      { role: "user", content: "Write a function" },
      { role: "assistant", content: "Here is a function" },
      { role: "user", content: "Fix the bug" },
    ],
  }

  const next: Request = {
    system: ["You are an assistant", "Be helpful", "Today's date: June 10, 2026"],
    messages: [
      { role: "user", content: "Write a function" },
      { role: "assistant", content: "Here is a function" },
      { role: "user", content: "Fix the bug" },
    ],
  }

  const report = computeDivergence(prev, next)
  console.log("Divergence Report:")
  console.log(`  Common tokens: ${report.commonTokens}/${report.totalTokens}`)
  console.log(`  Hit ratio: ${report.expectedHitRatio}`)
  console.log(`  Cause: ${report.divergenceCause}`)
  console.log(`  Divergence index: ${report.divergenceIndex}`)

  console.log("\nSections:")
  for (const s of report.sections) {
    console.log(`  ${s.section}: tokens[${s.startToken}..${s.endToken}] matched=${s.matched}`)
  }
}
