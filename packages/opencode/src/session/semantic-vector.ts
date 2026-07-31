/**
 * Semantic vector for message indexing and search ranking.
 *
 * Produces topic keywords + ordinal epistemic coefficients for FTS5 hybrid
 * ranking. Coefficients reflect a single dominant ClaimStatus (not a
 * distribution of "confidence scores"). Epistemic decisions use the Python
 * kernel's ClaimNode DAG — this module only ranks search results.
 */
export type SemanticVector = {
  keywords: Array<{ word: string; score: number }>
  dominant: string
  /** Ordinal coefficients: one-hot-ish, dominant status gets highest weight.
   *  Sum always ≤ 10. Used by memory.ts for BM25+epistemic hybrid ranking. */
  exactCoef: number
  inferredCoef: number
  hypotheticalCoef: number
  guessCoef: number
  unknownCoef: number
}

// ---------------------------------------------------------------------------
// Status classification — lightweight signals, not a full classifier
// ---------------------------------------------------------------------------

const SIGNALS: Array<{ status: keyof typeof STATUS_WEIGHTS; patterns: RegExp[] }> = [
  {
    status: "Exact",
    patterns: [
      /\b(exact|verified|confirmed|oracle\s*pass|test\s*pass(ed)?|all\s*pass|263\s*passed)\b/i,
      /\b\[Exact\]\b/,
      /\bground-truth\b/i,
    ],
  },
  {
    status: "Inferred",
    patterns: [
      /\b(inferred|derived|deduced|implies|therefore|thus|hence|because)\b/i,
      /\b\[Inferred\]\b/,
      /\bbased on\b/i,
    ],
  },
  {
    status: "Hypothetical",
    patterns: [
      /\b(if|suppose|assume|assuming|hypothesis|hypothetical|scenario|would|could|might|potentially)\b/i,
      /\b\[Hypothetical\]\b/,
      /\bwhat if\b/i,
    ],
  },
  {
    status: "Guess",
    patterns: [
      /\b(maybe|perhaps|guess|unsure|uncertain|doubt|speculate|not sure)\b/i,
      /\b\[Guess\]\b/,
      /\bshot in the dark\b/i,
    ],
  },
  {
    status: "Unknown",
    patterns: [
      /\b(unknown|unclear|undefined|missing|n\/a|tbd|todo|placeholder|stub|incomplete)\b/i,
      /\b\[Unknown\]\b/,
      /\bnot (available|applicable|found)\b/i,
    ],
  },
]

/** Ordinal weights per status. Sum = 10, monotonic. */
const STATUS_WEIGHTS = {
  Exact: [7, 2, 1, 0, 0],
  Inferred: [1, 6, 2, 1, 0],
  Hypothetical: [0, 1, 6, 2, 1],
  Guess: [0, 0, 1, 7, 2],
  Unknown: [0, 0, 0, 1, 9],
} as const

function classifyStatus(text: string): keyof typeof STATUS_WEIGHTS {
  for (const { status, patterns } of SIGNALS) {
    for (const re of patterns) {
      if (re.test(text)) return status
    }
  }
  // Default: inferred (most common for analytical/code text)
  return "Inferred"
}

// ---------------------------------------------------------------------------
// Topic keywords — lightweight domain detection
// ---------------------------------------------------------------------------

const TOPIC_PATTERNS: Array<{ topic: string; patterns: RegExp[] }> = [
  { topic: "database", patterns: [/\b(sql|table|query|schema|migration|fts|index|column|row|drizzle)\b/i] },
  { topic: "search", patterns: [/\b(fts5?|full-text|bm25|search|rank|relevance)\b/i] },
  { topic: "typescript", patterns: [/\b(typescript|ts|type|interface|generic|brand|schema)\b/i] },
  { topic: "python", patterns: [/\b(python|pip|pytest|venv|def |class |async |await )\b/i] },
  { topic: "rust", patterns: [/\b(rust|cargo|wasm|crate|borrow|lifetime|trait)\b/i] },
  { topic: "javascript", patterns: [/\b(javascript|node|npm|bun|jsx|promise|async)\b/i] },
  { topic: "config", patterns: [/\b(config|configuration|settings|options|env|environment)\b/i] },
  { topic: "error", patterns: [/\b(error|bug|crash|fail|exception|throw|catch|stack)\b/i] },
  { topic: "test", patterns: [/\b(test|spec|assert|expect|describe|pytest|vitest)\b/i] },
  { topic: "build", patterns: [/\b(build|compile|bundle|package|deploy|release|artifact)\b/i] },
  { topic: "file", patterns: [/\b(file|path|directory|folder|read|write|save|load)\b/i] },
  { topic: "api", patterns: [/\b(api|endpoint|request|response|http|rest|graphql)\b/i] },
  { topic: "performance", patterns: [/\b(perform|speed|fast|slow|optimize|benchmark|latency)\b/i] },
  { topic: "security", patterns: [/\b(security|auth|permission|token|secret|encrypt|hash)\b/i] },
  { topic: "ai", patterns: [/\b(model|llm|embedding|vector|semantic|inference|prompt|agent|oracle)\b/i] },
  { topic: "git", patterns: [/\b(git|commit|branch|merge|pull|push|rebase|diff|head)\b/i] },
  { topic: "reasoning", patterns: [/\b(reason|think|deliberate|reflect|consider|analyze)\b/i] },
  { topic: "epistemic", patterns: [/\b(epistemic|claim|evidence|verify|status|dag|weakest.link)\b/i] },
]

function classifyTopics(text: string): Array<{ word: string; score: number }> {
  const scores: Record<string, number> = {}
  for (const { topic, patterns } of TOPIC_PATTERNS) {
    let hits = 0
    for (const re of patterns) {
      const matches = text.match(re)
      if (matches) hits += matches.length
    }
    if (hits > 0) scores[topic] = hits
  }
  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
  if (sorted.length === 0) return [{ word: "general", score: 1.0 }]
  const max = sorted[0]![1]
  return sorted.map(([word, score]) => ({ word, score: Math.round((score / max) * 100) / 100 }))
}

// ---------------------------------------------------------------------------
// classifyText — main entry point
// ---------------------------------------------------------------------------

export function classifyText(text: string): SemanticVector {
  const status = classifyStatus(text)
  const [exactCoef, inferredCoef, hypotheticalCoef, guessCoef, unknownCoef] = STATUS_WEIGHTS[status]
  const keywords = classifyTopics(text)
  const dominant = keywords[0]?.word || "general"

  return {
    keywords,
    dominant,
    exactCoef,
    inferredCoef,
    hypotheticalCoef,
    guessCoef,
    unknownCoef,
  }
}

export function formatSemanticVector(sv: SemanticVector): string {
  const kwStr = sv.keywords.map((k) => `${k.word}(${k.score.toFixed(2)})`).join(" ")
  return kwStr
}
