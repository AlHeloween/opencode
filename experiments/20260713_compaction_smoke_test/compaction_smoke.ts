/**
 * Compaction Smoke Test — DeepSeek V4 Flash
 * 
 * Tests compaction behavior with reasoning ON vs reasoning OFF:
 *   1. Token output comparison (33 tokens vs hopefully 16K+)
 *   2. Summary structure quality (## Goal, ## Progress, etc.)
 *   3. Cache header behavior (prompt cache markers)
 *   4. Payload size for context budget estimation
 * 
 * Requires: DEEPSEEK_API_KEY env var
 * Run:      bun run experiments/20260713_compaction_smoke_test/compaction_smoke.ts
 */

// ---------------------------------------------------------------------------
// Helper: fetch DeepSeek API
// ---------------------------------------------------------------------------
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY
if (!DEEPSEEK_API_KEY) {
  console.error("❌  DEEPSEEK_API_KEY not set")
  process.exit(1)
}

const API_URL = "https://api.deepseek.com/chat/completions"

async function callDeepSeek(
  messages: { role: string; content: string }[],
  opts: {
    reasoning?: boolean
    maxTokens?: number
    label: string
    temperature?: number
  },
) {
  const body: Record<string, any> = {
    model: "deepseek-v4-flash",
    messages,
    stream: false,
    temperature: opts.temperature ?? 0.3,
  }

  // DeepSeek V4 Flash: reasoning is controlled by provider-specific options
  // Setting reasoningEffort or leaving it unset determines whether the model
  // uses its thinking tokens.
  if (opts.reasoning !== undefined) {
    // DeepSeek-compatible toggle: reasoning_content presence signals mode
    // reasoning=true → allow reasoning (default)
    // reasoning=false → suppress reasoning, force direct output
    body.reasoning = opts.reasoning
  }

  // Cap max_tokens to see how much the model actually uses
  if (opts.maxTokens !== undefined) {
    body.max_tokens = opts.maxTokens
  }

  const t0 = performance.now()
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      // DeepSeek uses X-DS-Prompt-Cache for prompt caching
      // We include it to track cache behavior
      "X-DS-Prompt-Cache": "true",
    },
    body: JSON.stringify(body),
  })
  const elapsed = performance.now() - t0

  const data = await res.json()

  if (!res.ok) {
    console.error(`❌  [${opts.label}] API error ${res.status}:`, JSON.stringify(data, null, 2))
    return null
  }

  const choice = data.choices?.[0]
  const usage = data.usage
  const text = choice?.message?.content ?? ""
  const reasoningText = choice?.message?.reasoning_content ?? ""

  // Extract cache header info
  const cacheHit = res.headers.get("x-ds-prompt-cache-hit") ?? "not-reported"
  const cacheReadTokens = usage?.prompt_cache_hit_tokens ?? 0
  const cacheWriteTokens = usage?.prompt_cache_miss_tokens ?? 0

  console.log(`────────────────────────────────────────────────────────`)
  console.log(`  Test: ${opts.label}`)
  console.log(`────────────────────────────────────────────────────────`)
  console.log(`  Status:         ${res.status} ${res.statusText}`)
  console.log(`  Duration:       ${(elapsed / 1000).toFixed(2)}s`)
  console.log(`  Cache hit:      ${cacheHit}`)
  console.log(`  ── Token Usage ──`)
  console.log(`  Input:          ${usage?.prompt_tokens ?? "?"}`)
  console.log(`  Output:         ${usage?.completion_tokens ?? "?"}`)
  console.log(`  Reasoning:      ${reasoningText.length > 0 ? reasoningText.length + " chars (thinking present)" : "none"}`)
  console.log(`  Cache read:     ${cacheReadTokens}`)
  console.log(`  Cache write:    ${cacheWriteTokens}`)
  console.log(`  Total:          ${usage?.total_tokens ?? "?"}`)
  console.log(`  ── Output ──`)
  console.log(`  Chars:          ${text.length}`)
  console.log(`  Est. tokens:    ${Math.ceil(text.length / 4)} (chars/4)`)

  // Check for structural quality
  const hasH2 = (text.match(/^##\s+/gm) ?? []).length
  const hasGoal = text.includes("## Goal")
  const hasProgress = text.includes("## Progress")
  const hasNext = text.includes("## Next Steps")
  const hasRelevant = text.includes("## Relevant Files")

  console.log(`  ── Structure (template compliance) ──`)
  console.log(`  ## sections:     ${hasH2}`)
  console.log(`  ## Goal:         ${hasGoal ? "✅" : "❌"}`)
  console.log(`  ## Progress:     ${hasProgress ? "✅" : "❌"}`)
  console.log(`  ## Next Steps:   ${hasNext ? "✅" : "❌"}`)
  console.log(`  ## Relevant Files: ${hasRelevant ? "✅" : "❌"}`)

  // Check for preamble text before ## Goal
  const goalIdx = text.indexOf("## Goal")
  const preamble = goalIdx > 0 ? text.slice(0, goalIdx).trim() : ""
  console.log(`  Preamble before ## Goal: ${preamble ? preamble.slice(0, 100) + "..." : "none ✅"}`)
  console.log()

  return { text, reasoningText, usage, elapsed, cacheHit }
}

// ---------------------------------------------------------------------------
// Compaction prompt — exactly as used in compaction.ts:459-503
// ---------------------------------------------------------------------------
const COMPACTION_PROMPT = `Please create a structured summary of the conversation history. Do not use any tools — just produce the summary.

Use this exact structure:

## Goal
- [single-sentence task summary]

## Constraints & Preferences
- [user constraints, preferences, specs, or "(none)"]

## Progress
### Done
- [completed work or "(none)"]

### In Progress
- [current work or "(none)"]

### Blocked
- [blockers or "(none)"]

## Commands & Outcomes
- [commands run (builds, tests, git) and their relevant results, or "(none)"]

## Errors & Fixes
- [problems encountered and how they were resolved, or "(none)"]

## Key Decisions
- [decision and why, or "(none)"]

## Next Steps
- [ordered next actions or "(none)"]

## Critical Context
- [important technical facts, errors, open questions, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, commands, error strings, and identifiers when known.
- Do not answer the conversation. Do not mention that you are summarizing, compacting, or merging context.
- Output ONLY the structured summary sections starting with ## Goal. No thinking, no analysis, no meta-commentary, no greeting, no sign-off.
- Start directly with ## Goal. Never prefix anything before it.`

// ---------------------------------------------------------------------------
// Simulated session context — realistic past messages that compaction would see
// ---------------------------------------------------------------------------
const SIMULATED_HISTORY = [
  { role: "user", content: "Can you look at the codegraph indexing issue? The tool returns empty results for some queries." },
  { role: "assistant", content: "I investigated the codegraph explorer query. The issue is that the FTS search uses LIKE on `nodes.name` but doesn't match qualified_name. Let me fix this in codegraph.ts." },
  { role: "user", content: "I also notice that the codegraph init fails silently when the .codegraph directory doesn't exist." },
  { role: "assistant", content: "Good catch. I added auto-creation of the .codegraph directory in bootstrap.ts. Also improved error reporting in the init flow." },
  { role: "user", content: "Can we make the codegraph tool work without external dependencies? I want the queries to be in-process." },
  { role: "assistant", content: "Rewrote the codegraph tool from CLI spawn to in-process bun:sqlite queries. Now supports search, trace, impact, and path modes without any external process dependency." },
  { role: "user", content: "Will the standalone binary work if I copy dist/bin to another drive?" },
  { role: "assistant", content: "Yes. The bootstrap uses sibling binary lookup (checks alongside process.execPath before PATH). So copying dist/bin/ to any location keeps both opencode.exe and codegraph.exe working together." },
]

// ---------------------------------------------------------------------------
// System prompt — compaction agent prefix (simplified but representative)
// This mirrors the actual compaction agent system prompt structure
// ---------------------------------------------------------------------------
const COMPACTION_SYSTEM_PROMPT = `You are a coding assistant.

## Role: Compaction

All directives defined in opencode_prompts_kernel.py as typed dicts.

from opencode_prompts_kernel import COMPACTION

# intent: Conversation compaction — anchored summary template
# forbidden_actions: No answering the conversation. No mentioning compaction.

# === SCOPE ===
# summarizes conversation_history
# preserves file_paths/identifiers/key_decisions

# === CONSTRAINTS ===
# follow_exact_template: True
# preserve_still_true: True
# remove_stale: True
# merge_new_facts: True
# same_language: True

# === INVARIANTS ===
# Must keep every section even when empty
# Must preserve exact file paths and identifiers
# Must use terse bullets over paragraphs
# Must respond in same language as conversation

# === FORBIDDEN ===
# DO NOT: Answering the conversation itself
# DO NOT: Mentioning that you are summarizing or compacting
# DO NOT: Omitting sections from the template`

// ---------------------------------------------------------------------------
// Main test
// ---------------------------------------------------------------------------
async function main() {
  console.log("=".repeat(56))
  console.log("  Compaction Smoke Test — DeepSeek V4 Flash")
  console.log("=".repeat(56))
  console.log()

  // Build messages list (system + history + compaction prompt)
  const messages = [
    ...SIMULATED_HISTORY,
    { role: "user", content: COMPACTION_PROMPT },
  ]

  // -----------------------------------------------------------------------
  // TEST 1: Reasoning ON (default) — current production behavior
  // -----------------------------------------------------------------------
  console.log("\n" + "#".repeat(56))
  console.log("#  TEST 1: Reasoning ON (default)")
  console.log("#".repeat(56))
  const result1 = await callDeepSeek(messages, {
    reasoning: true,
    maxTokens: 335_580, // matches production: rawMaxOutput * 3
    label: "Reasoning ON",
    temperature: 0.3,
  })

  // -----------------------------------------------------------------------
  // TEST 2: Reasoning OFF — proposed fix
  // -----------------------------------------------------------------------
  console.log("\n" + "#".repeat(56))
  console.log("#  TEST 2: Reasoning OFF")
  console.log("#".repeat(56))
  const result2 = await callDeepSeek(messages, {
    reasoning: false,
    maxTokens: 111_860, // no 3x multiplier = rawMaxOutput
    label: "Reasoning OFF",
    temperature: 0.3,
  })

  // -----------------------------------------------------------------------
  // TEST 3: Cache behavior — repeat reasoning OFF request
  // Tests whether the prompt prefix hits cache on consecutive identical calls
  // -----------------------------------------------------------------------
  console.log("\n" + "#".repeat(56))
  console.log("#  TEST 3: Cache test — repeat Reasoning OFF")
  console.log("#".repeat(56))
  const result3 = await callDeepSeek(messages, {
    reasoning: false,
    maxTokens: 111_860,
    label: "Reasoning OFF (cached)",
    temperature: 0.3,
  })

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log("\n" + "=".repeat(56))
  console.log("  RESULTS SUMMARY")
  console.log("=".repeat(56))
  console.log()

  if (result1) {
    const tok1 = Math.ceil(result1.text.length / 4)
    console.log(`  Reasoning ON:    ${result1.usage?.completion_tokens ?? tok1} output tokens, ${result1.text.length} chars, ${(result1.elapsed / 1000).toFixed(1)}s`)
  }
  if (result2) {
    const tok2 = Math.ceil(result2.text.length / 4)
    console.log(`  Reasoning OFF:   ${result2.usage?.completion_tokens ?? tok2} output tokens, ${result2.text.length} chars, ${(result2.elapsed / 1000).toFixed(1)}s`)
  }
  if (result3) {
    const tok3 = Math.ceil(result3.text.length / 4)
    console.log(`  Reasoning OFF*:  ${result3.usage?.completion_tokens ?? tok3} output tokens, ${result3.text.length} chars, ${(result3.elapsed / 1000).toFixed(1)}s`)
    console.log(`  Cache hit:       ${result3.cacheHit}`)
  }

  const ok1 = result1 && Math.ceil(result1.text.length / 4) >= 16384
  const ok2 = result2 && Math.ceil(result2.text.length / 4) >= 16384
  console.log()
  console.log(`  >= 16K tokens (target):  Reasoning ON: ${ok1 ? "✅ YES" : "❌ NO"}  |  Reasoning OFF: ${ok2 ? "✅ YES" : "❌ NO"}`)

  const structured1 = result1 && result1.text.includes("## Goal") && result1.text.includes("## Progress")
  const structured2 = result2 && result2.text.includes("## Goal") && result2.text.includes("## Progress")
  console.log(`  Structured (## Goal + ## Progress):  ON: ${structured1 ? "✅" : "❌"}  |  OFF: ${structured2 ? "✅" : "❌"}`)

  const noPreamble1 = result1 && !result1.text.slice(0, result1.text.indexOf("## Goal")).trim()
  const noPreamble2 = result2 && !result2.text.slice(0, result2.text.indexOf("## Goal")).trim()
  console.log(`  No preamble before ## Goal:         ON: ${noPreamble1 ? "✅" : "❌"}  |  OFF: ${noPreamble2 ? "✅" : "❌"}`)

  const systemTokens = result2?.usage?.prompt_tokens ?? "?"
  console.log(`\n  System + history + prompt: ${systemTokens} input tokens`)

  console.log()
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
