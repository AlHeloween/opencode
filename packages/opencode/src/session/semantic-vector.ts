export type SemanticVector = {
  keywords: Array<{ word: string; score: number }>
  dominant: string
  exactCoef: number
  inferredCoef: number
  hypotheticalCoef: number
  guessCoef: number
  unknownCoef: number
}

const EXACT_KEYWORDS = [
  "calculate",
  "compute",
  "result",
  "output",
  "error",
  "success",
  "done",
  "executed",
  "ran",
  "compiled",
  "built",
  "installed",
  "deployed",
  "test passed",
  "test failed",
  "assertion",
  "return",
  "function",
  "class",
  "interface",
  "type",
  "const",
  "let",
  "var",
  "import",
  "export",
  "module",
  "package",
  "version",
  "config",
  "definition",
  "schema",
  "table",
  "column",
  "index",
  "primary",
  "foreign",
  "key",
  "sql",
  "query",
  "select",
  "insert",
  "update",
  "delete",
  "create",
  "drop",
  "alter",
  "migration",
  "database",
  "table",
  "row",
  "record",
  "file",
  "path",
  "directory",
  "exists",
  "found",
  "not found",
  "read",
  "write",
  "open",
  "close",
  "save",
  "load",
  "parse",
  "serialize",
  "deserialize",
  "encode",
  "decode",
  "hash",
  "md5",
  "checksum",
  "verify",
  "validated",
  "confirmed",
  "exact",
  "equals",
  "equal",
  "same",
  "identical",
  "match",
  "matches",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
]

const INFERRED_KEYWORDS = [
  "likely",
  "probably",
  "appears",
  "suggests",
  "indicates",
  "inferred",
  "implied",
  "assumed",
  "presumed",
  "deduced",
  "concluded",
  "derived",
  "estimated",
  "approximate",
  "roughly",
  "seems",
  "looks like",
  "based on",
  "according to",
  "evidence",
  "pattern",
  "trend",
  "correlation",
  "association",
  "inferred",
  "not calculated",
  "not computed",
  "derived from",
]

const HYPOTHETICAL_KEYWORDS = [
  "if",
  "suppose",
  "what if",
  "could be",
  "might be",
  "would be",
  "should be",
  "may be",
  "potentially",
  "possibly",
  "hypothetically",
  "theoretical",
  "speculation",
  "hypothesis",
  "assumption",
  "scenario",
  "case",
  "condition",
  "given that",
  "assuming",
  "in theory",
  "ideally",
  "conceptually",
]

const GUESS_KEYWORDS = [
  "maybe",
  "perhaps",
  "I guess",
  "not sure",
  "unsure",
  "uncertain",
  "doubt",
  "questionable",
  "speculate",
  "wild guess",
  "shot in the dark",
  "no idea",
  "don't know",
  "dunno",
  "idk",
  "shrug",
  "try",
  "attempt",
  "experiment",
  "test",
  "see if",
]

const UNKNOWN_KEYWORDS = [
  "unknown",
  "unclear",
  "undefined",
  "missing",
  "absent",
  "null",
  "none",
  "n/a",
  "not available",
  "not applicable",
  "tbd",
  "todo",
  "placeholder",
  "stub",
  "incomplete",
  "partial",
  "incomplete",
  "error",
  "failed",
  "crashed",
  "broken",
  "bug",
  "issue",
]

const TOPIC_KEYWORDS: Record<string, string[]> = {
  stoichiometry: ["stoichiometry", "molar", "mole", "ratio", "reaction", "equation", "balance"],
  database: ["database", "sql", "table", "query", "schema", "migration", "fts", "index", "column", "row"],
  search: ["search", "fts", "fts5", "full-text", "match", "query", "rank", "bm25", "relevance"],
  typescript: ["typescript", "ts", "type", "interface", "generics", "infer", "brand", "schema"],
  rust: ["rust", "cargo", "wasm", "crate", "borrow", "lifetime", "trait"],
  python: ["python", "pip", "venv", "import", "def", "class", "async", "await"],
  javascript: ["javascript", "node", "npm", "bun", "require", "module", "async", "promise"],
  config: ["config", "configuration", "settings", "options", "parameters", "env", "environment"],
  error: ["error", "bug", "crash", "fail", "exception", "throw", "catch"],
  test: ["test", "spec", "assert", "expect", "describe", "it", "unit", "integration"],
  build: ["build", "compile", "bundle", "package", "deploy", "release", "artifact"],
  file: ["file", "path", "directory", "folder", "read", "write", "save", "load"],
  api: ["api", "endpoint", "request", "response", "http", "rest", "graphql", "client", "server"],
  performance: ["performance", "speed", "fast", "slow", "optimize", "benchmark", "latency", "throughput"],
  security: ["security", "auth", "permission", "token", "key", "secret", "encrypt", "hash"],
  ai: ["ai", "model", "llm", "embedding", "vector", "semantic", "inference", "prompt", "agent"],
  data: ["data", "dataset", "csv", "json", "array", "object", "record", "field"],
  git: ["git", "commit", "branch", "merge", "pull", "push", "rebase", "diff", "head"],
  docker: ["docker", "container", "image", "compose", "volume", "network", "build"],
}

export function classifyText(text: string): SemanticVector {
  const lower = text.toLowerCase()
  const words = lower.split(/[\s\W]+/).filter((w) => w.length > 0)
  const wordSet = new Set(words)

  let exactCoef = 0
  let inferredCoef = 0
  let hypotheticalCoef = 0
  let guessCoef = 0
  let unknownCoef = 0

  for (const kw of EXACT_KEYWORDS) {
    if (lower.includes(kw)) exactCoef += 2
  }
  for (const kw of INFERRED_KEYWORDS) {
    if (lower.includes(kw)) inferredCoef += 2
  }
  for (const kw of HYPOTHETICAL_KEYWORDS) {
    if (lower.includes(kw)) hypotheticalCoef += 2
  }
  for (const kw of GUESS_KEYWORDS) {
    if (lower.includes(kw)) guessCoef += 2
  }
  for (const kw of UNKNOWN_KEYWORDS) {
    if (lower.includes(kw)) unknownCoef += 2
  }

  const total = exactCoef + inferredCoef + hypotheticalCoef + guessCoef + unknownCoef
  if (total === 0) {
    exactCoef = 6
    inferredCoef = 2
    hypotheticalCoef = 1
    guessCoef = 0
    unknownCoef = 1
  }

  const scale = 10 / Math.max(total, 1)
  exactCoef = Math.round(exactCoef * scale)
  inferredCoef = Math.round(inferredCoef * scale)
  hypotheticalCoef = Math.round(hypotheticalCoef * scale)
  guessCoef = Math.round(guessCoef * scale)
  unknownCoef = Math.round(unknownCoef * scale)

  const diff = 10 - (exactCoef + inferredCoef + hypotheticalCoef + guessCoef + unknownCoef)
  exactCoef += diff

  const topicScores: Record<string, number> = {}
  for (const [topic, kws] of Object.entries(TOPIC_KEYWORDS)) {
    let score = 0
    for (const kw of kws) {
      if (lower.includes(kw)) score += 3
    }
    if (score > 0) topicScores[topic] = score
  }

  const sortedTopics = Object.entries(topicScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)

  const keywords = sortedTopics.map(([word, score]) => ({
    word,
    score: Math.round((score / (sortedTopics[0]?.[1] || 1)) * 100) / 100,
  }))

  const dominant = sortedTopics[0]?.[0] || "general"

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
