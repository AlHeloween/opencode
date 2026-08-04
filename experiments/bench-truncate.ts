/**
 * Benchmark: RequestDiff.formatRequest with OUTPUT_TOKEN_MAX * 4 message limit.
 *
 * Verifies:
 * 1. No mid-word truncation (word-boundary respect)
 * 2. Performance < 10ms for max-size messages (128K chars)
 * 3. Real module import (not replica)
 *
 * Usage: bun run experiments/bench-truncate.ts
 */

import { RequestDiff, type DiffMeta } from "../packages/opencode/src/session/request-diff"
import type { ModelMessage } from "ai"

const meta: DiffMeta = {
  sessionID: "ses_bench_001",
  modelID: "bench-model",
  providerID: "bench-provider",
  turn: 1,
  agent: "build",
  timestamp: Date.now(),
}

const system = [
  "[session: ses_bench_001]",
  "You are a coding agent. Use tools to accomplish tasks.",
]

// Generate a large message (~140K chars — above the 128K limit)
function largeMessage(targetChars: number): ModelMessage {
  const block =
    "Это тестовое сообщение с русским текстом чтобы проверить что перенос " +
    "не разрывает слово завершённых посередине. The quick brown fox jumps over " +
    "the lazy dog. const MAX_FORMATTED_MESSAGE_CHARS = OUTPUT_TOKEN_MAX * 4; " +
    "function truncateText(text: string, maxChars: number, label: string): string { } " +
    "неправильно_обрезанное_слово_из_длинного_компактного_блока "
  const repeats = Math.ceil(targetChars / block.length)
  const content = Array(repeats).fill(block).join(" ").slice(0, targetChars)
  return { role: "assistant", content }
}

// --- Test 1: Word boundary respect ---
console.log("=== Test 1: Word boundary respect ===")
const msg1: ModelMessage = {
  role: "assistant",
  content: "| Планы | 6 дубликатов удалены, 4 завершённых в `plans_completed` |",
}
const result1 = RequestDiff.formatRequest(system, [msg1], meta)
// Find the formatted message content
const msgSection1 = result1.split("=== MESSAGES ===")[1] ?? ""
console.log(`  Message section (${msgSection1.length} chars):`)
console.log(`  ${msgSection1.slice(0, 200)}`)
const hasSplit = msgSection1.includes("заверш") && !msgSection1.includes("завершённых")
console.log(`  PASS: ${hasSplit ? "❌ — word split detected!" : "✅ — word intact"}`)

// --- Test 2: Large message (140K chars, exceeds 128K limit) ---
console.log("\n=== Test 2: Large message truncation ===")
const bigMsg = largeMessage(140_000)
console.log(`  Input size: ${(bigMsg.content as string).length.toLocaleString()} chars`)

const t0 = performance.now()
const result2 = RequestDiff.formatRequest(system, [bigMsg], meta)
const t1 = performance.now()
const elapsed = t1 - t0

console.log(`  formatRequest time: ${elapsed.toFixed(2)} ms`)
console.log(`  Output size: ${result2.length.toLocaleString()} chars`)
console.log(`  PASS: ${elapsed < 10 ? "✅" : "⚠️ — over 10ms"}`)

// Check word boundary in truncated output
const msgSection2 = result2.split("=== MESSAGES ===")[1] ?? ""
const truncMarker = msgSection2.indexOf("\n... (")
if (truncMarker > 0) {
  const lastChar = msgSection2[truncMarker - 1]
  console.log(`  Last char before truncation: '${lastChar}' (code ${lastChar.charCodeAt(0)})`)
  const isBoundary = lastChar === " " || lastChar === "\n" || lastChar === "\t"
  console.log(`  Word boundary: ${isBoundary ? "✅" : "❌ — mid-word cut!"}`)
} else {
  console.log(`  No truncation needed — message fit within ${result2.length} chars`)
}

// --- Test 3: 100-iteration stability ---
console.log("\n=== Test 3: 100-iteration benchmark ===")
const runs = 100
const t0r = performance.now()
for (let i = 0; i < runs; i++) {
  RequestDiff.formatRequest(system, [bigMsg], { ...meta, turn: i })
}
const t1r = performance.now()
console.log(`  Runs: ${runs}`)
console.log(`  Total: ${(t1r - t0r).toFixed(2)} ms`)
console.log(`  Avg: ${((t1r - t0r) / runs).toFixed(4)} ms/call`)
console.log(`  PASS: ${(t1r - t0r) / runs < 10 ? "✅" : "❌ — avg exceeds 10ms!"}`)

// --- Test 4: Short message (fast path) ---
console.log("\n=== Test 4: Short message (no truncation) ===")
const shortMsg: ModelMessage = { role: "user", content: "hello world" }
const t0s = performance.now()
for (let i = 0; i < 1000; i++) {
  RequestDiff.formatRequest(system, [shortMsg], { ...meta, turn: i })
}
const t1s = performance.now()
console.log(`  Avg: ${((t1s - t0s) / 1000).toFixed(4)} ms/call`)
console.log(`  PASS: ${t1s - t0s < 100 ? "✅" : "⚠️"}`)

console.log("\n=== Done ===")
