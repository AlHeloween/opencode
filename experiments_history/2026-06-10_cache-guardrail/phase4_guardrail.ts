/**
 * Phase 4: Cache Guardrail Prototype
 *
 * Integrates Phase 2 (divergence detection) with a decision matrix to
 * predict cache breaks BEFORE sending requests to DeepSeek.
 *
 * Provides: warn, block, or restructure recommendations.
 */

import type { DivergenceReport, DivergenceCause, Request } from "./phase2_divergence"
import { computeDivergence } from "./phase2_divergence"

// ── Types ──────────────────────────────────────────────────────────────────

export interface GuardrailConfig {
  /** Minimum acceptable cache hit ratio before warning. Default: 0.5 */
  minHitRatio: number
  /** Guardrail mode: warn only, or block + restructure */
  mode: "warn" | "restructure" | "strict"
  /** Strategy for handling date changes in system prompt */
  dateStrategy: "warn" | "remove" | "move_to_user"
  /** Semantic similarity threshold for "close enough" content (Phase 3 calibrated) */
  semanticThreshold: number
}

export type GuardrailActionType = "pass" | "warn" | "block" | "restructure"

export interface GuardrailAction {
  type: GuardrailActionType
  cause: DivergenceCause | null
  reason: string
  changes?: RestructureChange[]
  predictedHitRatio: number
  actionability: "none" | "fixable" | "unavoidable"
}

export interface RestructureChange {
  type: "remove_date_from_system" | "reorder_sections" | "keep_original_wording" | "warn_only"
  description: string
  before?: string
  after?: string
}

export interface GuardrailReport {
  passed: boolean
  action: GuardrailAction
  divergence: DivergenceReport
}

// ── Default config ─────────────────────────────────────────────────────────

export const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = {
  minHitRatio: 0.5,
  mode: "warn",
  dateStrategy: "warn",
  semanticThreshold: 0.75,
}

// ── Decision Matrix ────────────────────────────────────────────────────────

function decideAction(
  report: DivergenceReport,
  config: GuardrailConfig,
): GuardrailAction {
  const { divergenceCause, expectedHitRatio } = report

  // Date change ALWAYS warns: it's a poison pill that kills cache for ALL
  // subsequent tokens (the entire conversation after the date line).
  if (divergenceCause === "date_changed") {
    if (config.dateStrategy === "remove" && config.mode !== "warn") {
      return {
        type: "restructure",
        cause: "date_changed",
        reason: `Date in system prompt creates cache divergence at token ${report.divergenceIndex}. Restructuring to remove date.`,
        predictedHitRatio: expectedHitRatio,
        actionability: "fixable",
        changes: [{
          type: "remove_date_from_system",
          description: "Remove 'Today's date: ...' from system[2] to preserve cache for conversation tokens",
        }],
      }
    }
    return {
      type: "warn",
      cause: "date_changed",
      reason: `Date changed in system prompt at token ${report.divergenceIndex}. ALL subsequent tokens (including the entire conversation) are cache misses. Consider removing date or using stable string.`,
      predictedHitRatio: expectedHitRatio,
      actionability: "fixable",
    }
  }

  // Pass: cache will be fine
  if (expectedHitRatio >= config.minHitRatio) {
    return {
      type: "pass",
      cause: null,
      reason: `Cache hit ratio ${(expectedHitRatio * 100).toFixed(0)}% >= ${(config.minHitRatio * 100).toFixed(0)}% minimum`,
      predictedHitRatio: expectedHitRatio,
      actionability: "none",
    }
  }

  // System prompt changed: major change, needs review
  if (divergenceCause === "system_prompt_changed") {
    if (config.mode === "strict") {
      return {
        type: "block",
        cause: "system_prompt_changed",
        reason: "System prompt changed between requests. This completely invalidates the cache. Review the prompt change before proceeding.",
        predictedHitRatio: expectedHitRatio,
        actionability: "unavoidable",
      }
    }
    return {
      type: "warn",
      cause: "system_prompt_changed",
      reason: "System prompt changed between requests. Cache will be fully invalidated.",
      predictedHitRatio: expectedHitRatio,
      actionability: "unavoidable",
    }
  }

  // New messages appended: expected
  if (divergenceCause === "new_message_appended") {
    // Recalculate: new messages are expected, so adjust minHitRatio lower
    const adjustedRatio = expectedHitRatio * 1.5 // Loosen threshold
    if (adjustedRatio >= config.minHitRatio) {
      return {
        type: "pass",
        cause: "new_message_appended",
        reason: "New messages appended — expected growth. Prefix is stable.",
        predictedHitRatio: expectedHitRatio,
        actionability: "none",
      }
    }
    return {
      type: "warn",
      cause: "new_message_appended",
      reason: `New messages appended but prefix is short (${expectedHitRatio.toFixed(2)}). Consider compacting.`,
      predictedHitRatio: expectedHitRatio,
      actionability: "fixable",
    }
  }

  // Section reordered: fixable
  if (divergenceCause === "section_reordered") {
    if (config.mode !== "warn") {
      return {
        type: "restructure",
        cause: "section_reordered",
        reason: "Sections reordered — cache divergence at reorder point. Restructuring to match original order.",
        predictedHitRatio: expectedHitRatio,
        actionability: "fixable",
        changes: [{
          type: "reorder_sections",
          description: "Reorder output sections to match previous request order for cache stability",
        }],
      }
    }
    return {
      type: "warn",
      cause: "section_reordered",
      reason: "Sections reordered — cache divergence at reorder point.",
      predictedHitRatio: expectedHitRatio,
      actionability: "fixable",
    }
  }

  // Default: content modified
  return {
    type: "warn",
    cause: divergenceCause,
    reason: `Content modified (${divergenceCause}). Cache will break at divergence point. Expected hit ratio: ${(expectedHitRatio * 100).toFixed(0)}%`,
    predictedHitRatio: expectedHitRatio,
    actionability: "unavoidable",
  }
}

// ── Main Guardrail ─────────────────────────────────────────────────────────

export function guardrailCheck(
  prevRequest: Request | null,
  nextRequest: Request,
  config: Partial<GuardrailConfig> = {},
): GuardrailReport {
  const cfg = { ...DEFAULT_GUARDRAIL_CONFIG, ...config }

  // First request: no baseline to compare
  if (!prevRequest) {
    return {
      passed: true,
      action: {
        type: "pass",
        cause: null,
        reason: "First request — no prior cache baseline exists.",
        predictedHitRatio: 0,
        actionability: "none",
      },
      divergence: {
        totalTokens: 0,
        commonTokens: 0,
        divergenceIndex: 0,
        divergenceCause: "identical",
        expectedHitRatio: 0,
        sections: [],
      },
    }
  }

  const divergence = computeDivergence(prevRequest, nextRequest)
  const action = decideAction(divergence, cfg)

  return {
    passed: action.type === "pass",
    action,
    divergence,
  }
}

// ── Helper: Restructure request ────────────────────────────────────────────

export function restructureRequest(
  original: Request,
  action: GuardrailAction,
): Request | null {
  if (!action.changes || action.changes.length === 0) return null

  const result: Request = {
    system: [...original.system],
    messages: original.messages.map((m) => ({ ...m, content: m.content })),
  }

  for (const change of action.changes) {
    switch (change.type) {
      case "remove_date_from_system": {
        // Find and remove date from system[2], inject into first user message
        if (result.system.length > 2) {
          result.system[2] = result.system[2]
            .replace(/Today'?s?\s*date\s*:?\s*[A-Za-z]+\s+\d{1,2},?\s*\d{4}/gi, "")
            .replace(/\s{2,}/g, " ")
            .trim()
        }
        break
      }
      case "warn_only": {
        // No structural change, just a warning was issued
        break
      }
      // "reorder_sections" and "keep_original_wording" need Phase 3 integration
      // for semantic content matching — placeholder for now
      default:
        break
    }
  }

  return result
}

// ── Self-test ──────────────────────────────────────────────────────────────

if (import.meta.main) {
  const prev: Request = {
    system: ["You are an assistant", "Be helpful", "Today's date: June 9, 2026"],
    messages: [
      { role: "user", content: "Write a sort function" },
    ],
  }

  const next_good: Request = {
    system: ["You are an assistant", "Be helpful", "Today's date: June 9, 2026"],
    messages: [
      { role: "user", content: "Write a sort function" },
      { role: "assistant", content: "Here is the sort function" },
      { role: "user", content: "Now add error handling" },
    ],
  }

  const next_date_changed: Request = {
    system: ["You are an assistant", "Be helpful", "Today's date: June 10, 2026"],
    messages: [
      { role: "user", content: "Write a sort function" },
    ],
  }

  const next_prompt_changed: Request = {
    system: ["You are a different assistant", "Be helpful", "Today's date: June 9, 2026"],
    messages: [
      { role: "user", content: "Write a sort function" },
    ],
  }

  console.log("=" .repeat(60))
  console.log("Phase 4: Cache Guardrail Prototype")
  console.log("=" .repeat(60))

  // Test 1: Good request (cache hit expected)
  console.log("\n── Test 1: Normal append (should pass) ──")
  const r1 = guardrailCheck(prev, next_good)
  console.log(`  PASSED: ${r1.passed}`)
  console.log(`  Action: ${r1.action.type} — ${r1.action.reason}`)
  console.log(`  Hit ratio: ${r1.divergence.expectedHitRatio}`)
  console.log(`  Cause: ${r1.divergence.divergenceCause}`)

  // Test 2: Date changed (should warn)
  console.log("\n── Test 2: Date changed (should warn) ──")
  const r2 = guardrailCheck(prev, next_date_changed)
  console.log(`  PASSED: ${r2.passed}`)
  console.log(`  Action: ${r2.action.type} — ${r2.action.reason}`)
  console.log(`  Hit ratio: ${r2.divergence.expectedHitRatio}`)
  console.log(`  Cause: ${r2.divergence.divergenceCause}`)

  // Test 3: System prompt changed (should warn/block)
  console.log("\n── Test 3: System prompt changed (should warn) ──")
  const r3 = guardrailCheck(prev, next_prompt_changed)
  console.log(`  PASSED: ${r3.passed}`)
  console.log(`  Action: ${r3.action.type} — ${r3.action.reason}`)
  console.log(`  Actionability: ${r3.action.actionability}`)

  // Test 4: Strict mode with prompt change (should block)
  console.log("\n── Test 4: Strict mode + prompt change (should block) ──")
  const r4 = guardrailCheck(prev, next_prompt_changed, { mode: "strict" })
  console.log(`  PASSED: ${r4.passed}`)
  console.log(`  Action: ${r4.action.type} — ${r4.action.reason}`)

  // Test 5: First request (no baseline)
  console.log("\n── Test 5: First request (should pass) ──")
  const r5 = guardrailCheck(null, next_good)
  console.log(`  PASSED: ${r5.passed}`)
  console.log(`  Action: ${r5.action.type} — ${r5.action.reason}`)

  // Test 6: Restructure date
  console.log("\n── Test 6: Date restructure ──")
  const r6 = guardrailCheck(prev, next_date_changed, { mode: "restructure", dateStrategy: "remove" })
  console.log(`  Action: ${r6.action.type}`)
  if (r6.action.changes) {
    const restructured = restructureRequest(next_date_changed, r6.action)
    console.log(`  Original system[2]: "${next_date_changed.system[2]}"`)
    console.log(`  Restructured system[2]: "${restructured?.system[2]}"`)
  }

  console.log("\n[DONE] Phase 4 complete.")
}
