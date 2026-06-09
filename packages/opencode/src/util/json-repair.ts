/**
 * JSON repair utility for LLM-generated tool call arguments.
 *
 * LLMs occasionally emit malformed JSON (extra brackets, trailing commas,
 * garbage text after valid JSON, unescaped control characters in strings).
 * This module attempts auto-repair before routing to the "invalid" tool
 * fallback.
 */
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "json-repair" })

/**
 * Attempt to repair malformed JSON by applying common fixes in order of
 * likelihood. Returns the repaired JSON string if successful, or null if
 * all repair strategies fail.
 */
export function repairJson(input: string): string | null {
  let candidate = input.trim()
  if (candidate.length === 0) return null

  // Strategy 0: fast path — input is already valid JSON
  if (tryParse(candidate)) return candidate

  // Strategy 1: escape unescaped control characters inside JSON strings.
  // LLMs often emit literal newlines (0x0A), tabs (0x09), or carriage
  // returns (0x0D) inside string values, which breaks JSON.parse().
  // Escaping never changes JSON structure, so we apply it once and use
  // the result for all subsequent structural fixes.
  const escaped = escapeStringControlChars(candidate)
  if (escaped !== candidate) {
    if (tryParse(escaped)) {
      log.info("escaped control characters in tool call JSON")
      return escaped
    }
    candidate = escaped
  }

  // Strategy 2: remove trailing commas before ] or }
  let repaired = candidate.replace(/,\s*([}\]])/g, "$1")
  if (tryParse(repaired)) {
    log.info("repaired trailing comma in tool call JSON")
    return repaired
  }

  // Strategy 3: balance excess closing brackets (most common LLM error)
  // LLMs sometimes add extra ] or } at the end of JSON objects/arrays
  repaired = balanceBrackets(repaired)
  if (tryParse(repaired)) {
    log.info("repaired unbalanced brackets in tool call JSON")
    return repaired
  }

  // Strategy 4: extract the longest valid JSON prefix
  // Handles trailing garbage text after a valid JSON block
  const prefix = extractValidPrefix(repaired)
  if (prefix !== null) {
    log.info("extracted valid JSON prefix from tool call arguments")
    return prefix
  }

  // Strategy 5: combine trailing comma removal + bracket balancing
  repaired = balanceBrackets(candidate.replace(/,\s*([}\]])/g, "$1"))
  if (repaired !== candidate && tryParse(repaired)) {
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
 * Escape unescaped control characters (newlines, tabs, carriage returns,
 * and other 0x00-0x1F bytes) found inside JSON string values.
 *
 * Uses a simple state machine: tracks whether we're inside a JSON string
 * and whether the previous character was an unescaped backslash. Control
 * characters found inside strings are replaced with their JSON escape
 * sequences. Characters outside strings pass through unmodified.
 *
 * Already-escaped sequences (\\n, \\t, \\r, \\\", \\\\) are preserved
 * as-is — the `escaped` flag ensures we don't double-escape them.
 */
function escapeStringControlChars(input: string): string {
  let result = ""
  let inString = false
  let escaped = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (escaped) {
      // Previous char was an unescaped backslash — this character is part
      // of an existing escape sequence (\\n, \\t, \\\\, \\\", etc.).
      // Preserve it as-is and clear the escaped flag.
      result += ch
      escaped = false
      continue
    }

    if (ch === "\\") {
      // Start of a potential escape sequence. Output the backslash and
      // set the flag so the next character is treated as escaped.
      result += ch
      escaped = true
      continue
    }

    if (ch === '"') {
      inString = !inString
      result += ch
      continue
    }

    if (inString && isControlChar(ch)) {
      result += escapeChar(ch)
      continue
    }

    result += ch
  }

  return result
}

function isControlChar(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return code <= 0x1f
}

function escapeChar(ch: string): string {
  switch (ch) {
    case "\n": return "\\n"
    case "\r": return "\\r"
    case "\t": return "\\t"
    default: {
      const hex = ch.charCodeAt(0).toString(16).padStart(4, "0")
      return `\\u${hex}`
    }
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
