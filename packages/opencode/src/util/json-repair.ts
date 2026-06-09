/**
 * JSON repair utility for LLM-generated tool call arguments.
 *
 * LLMs occasionally emit malformed JSON (extra brackets, trailing commas,
 * garbage text after valid JSON). This module attempts auto-repair before
 * routing to the "invalid" tool fallback.
 */
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "json-repair" })

/**
 * Attempt to repair malformed JSON by applying common fixes in order of
 * likelihood. Returns the repaired JSON string if successful, or null if
 * all repair strategies fail.
 */
export function repairJson(input: string): string | null {
  let repaired = input.trim()
  if (repaired.length === 0) return null

  // Strategy 0: fast path — input is already valid JSON
  if (tryParse(repaired)) return repaired

  // Strategy 1: remove trailing commas before ] or }
  repaired = repaired.replace(/,\s*([}\]])/g, "$1")
  if (tryParse(repaired)) {
    log.info("repaired trailing comma in tool call JSON")
    return repaired
  }

  // Strategy 2: balance excess closing brackets (most common LLM error)
  // LLMs sometimes add extra ] or } at the end of JSON objects/arrays
  repaired = balanceBrackets(repaired)
  if (tryParse(repaired)) {
    log.info("repaired unbalanced brackets in tool call JSON")
    return repaired
  }

  // Strategy 3: extract the longest valid JSON prefix
  // Handles trailing garbage text after a valid JSON block
  const prefix = extractValidPrefix(repaired)
  if (prefix !== null) {
    log.info("extracted valid JSON prefix from tool call arguments")
    return prefix
  }

  // Strategy 4: combine trailing comma removal + bracket balancing
  repaired = balanceBrackets(input.trim().replace(/,\s*([}\]])/g, "$1"))
  if (repaired !== input.trim() && tryParse(repaired)) {
    log.info("repaired trailing comma + unbalanced brackets in tool call JSON")
    return repaired
  }

  return null
}

function tryParse(json: string): boolean {
  try {
    JSON.parse(json)
    return true
  } catch {
    return false
  }
}

/**
 * Count opening and closing brackets. If excess closing brackets exist,
 * remove them from the tail of the string (they are almost always trailing
 * artifacts, not mid-string errors).
 */
function balanceBrackets(input: string): string {
  // Count [ and ] separately from { and } so we handle each pair independently
  const squareOpen = (input.match(/\[/g) ?? []).length
  const squareClose = (input.match(/\]/g) ?? []).length
  const curlyOpen = (input.match(/\{/g) ?? []).length
  const curlyClose = (input.match(/\}/g) ?? []).length

  let result = input

  // Remove excess trailing ] first, then excess trailing }
  // Order matters: process from inner (array) to outer (object)
  let excess = squareClose - squareOpen
  while (excess > 0) {
    const idx = result.lastIndexOf("]")
    if (idx === -1) break
    // Only remove if it's trailing (followed only by whitespace or } )
    const after = result.slice(idx + 1)
    if (/^[\s}]*$/.test(after)) {
      result = result.slice(0, idx) + result.slice(idx + 1)
      excess--
    } else {
      break // ] found but not trailing — don't risk mid-string removal
    }
  }

  excess = curlyClose - curlyOpen
  while (excess > 0) {
    const idx = result.lastIndexOf("}")
    if (idx === -1) break
    const after = result.slice(idx + 1)
    if (/^\s*$/.test(after)) {
      result = result.slice(0, idx) + result.slice(idx + 1)
      excess--
    } else {
      break
    }
  }

  return result
}

/**
 * Try to extract the longest valid JSON prefix from a string.
 * This handles cases where valid JSON is followed by garbage text.
 */
function extractValidPrefix(input: string): string | null {
  // Only attempt if the input starts with { or [
  if (!input.startsWith("{") && !input.startsWith("[")) return null

  // Search for the longest valid prefix by finding possible end positions
  // and checking each one
  for (let len = input.length; len > 0; len--) {
    const candidate = input.slice(0, len)
    if (tryParse(candidate)) return candidate
  }

  return null
}
