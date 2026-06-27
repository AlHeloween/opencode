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

  // Strategy 0: strip control characters (0x00-0x1F except 0x09 tab, 0x0A LF, 0x0D CR)
  // before any repair attempt. JSON spec forbids control characters outside strings,
  // and LLMs occasionally emit null bytes or other control chars that break JSON.parse.
  candidate = candidate.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
  if (candidate.length === 0) return null

  // Strategy 0.5: fast path — input is already valid JSON
  if (tryParse(candidate)) return candidate

  // Strategy 0.5: convert single-quoted JSON to double-quoted.
  // LLMs sometimes emit Python-style single-quoted JSON like
  // {'key': 'value'}. Detect and convert before structural fixes.
  if (candidate.includes("'")) {
    const converted = convertSingleToDoubleQuotes(candidate)
    if (converted !== candidate) {
      if (tryParse(converted)) {
        log.info("converted single-quoted JSON to double-quoted in tool call")
        return converted
      }
      // Conversion produced different but still-invalid JSON — use converted
      // version as the new candidate for subsequent structural repairs
      // (e.g. trailing commas, unbalanced brackets).
      candidate = converted
    }
  }

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

  // Strategy 3.5: close unterminated strings and missing brackets.
  // When LLMs truncate long string values, the closing " and matching
  // brackets are lost. Detect open structures at EOF and append the
  // needed closers in correct nesting order (strings first, then brackets
  // in LIFO order — inner arrays before outer objects).
  repaired = closeOpenStructures(repaired)
  if (tryParse(repaired)) {
    log.info("closed unterminated string/missing brackets in tool call JSON")
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
 * Convert single-quoted JSON to double-quoted JSON.
 *
 * LLMs (especially those trained on Python) sometimes emit single-quoted
 * JSON like {'key': 'value'}. This function uses a state machine to
 * convert delimiter single quotes to double quotes while preserving:
 * - Escaped single quotes inside strings (\' → \")
 * - Double quotes inside single-quoted strings (escape them)
 * - Apostrophes in English text (he's → he's, left as-is)
 *
 * Returns the converted string, or the original if no conversion was needed.
 */
function convertSingleToDoubleQuotes(input: string): string {
  let result = ""
  let inSingle = false
  let inDouble = false
  let escaped = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (escaped) {
      // Previous char was an unescaped backslash
      if (inSingle && ch === "'") {
        // \' inside single-quoted string = escaped single quote (value: ').
        // Remove the backslash we already output, just emit the quote.
        result = result.slice(0, -1)
        result += "'"
        escaped = false
        continue
      }
      result += ch
      escaped = false
      continue
    }

    if (ch === "\\") {
      result += ch
      escaped = true
      continue
    }

    if (inDouble) {
      // Inside a double-quoted string — pass through everything
      if (ch === '"') inDouble = false
      result += ch
      continue
    }

    if (inSingle) {
      // Inside a single-quoted string
      if (ch === "'") {
        // End of single-quoted string → convert to double quote
        inSingle = false
        result += '"'
        continue
      }
      if (ch === '"') {
        // Double quote inside single-quoted string — escape it
        result += '\\"'
        continue
      }
      result += ch
      continue
    }

    // Outside any string
    if (ch === "'") {
      // Check if this looks like a JSON string delimiter (not an apostrophe).
      // JSON delimiters appear after: { [ , : or at start of value.
      // Apostrophes appear mid-word (he's, don't, it's).
      const prev = i > 0 ? input[i - 1] : ""
      const isDelimiterPosition = !prev || /[{[,:]/.test(prev) || /\s/.test(prev)
      if (isDelimiterPosition) {
        inSingle = true
        result += '"'
        continue
      }
      // Apostrophe — leave as-is
      result += ch
      continue
    }

    if (ch === '"') {
      inDouble = true
      result += ch
      continue
    }

    result += ch
  }

  return result
}

/**
 * Produce an actionable error message from a raw JSON parse error.
 *
 * When the AI SDK's `JSON.parse()` fails on an LLM-generated tool call,
 * the raw error (e.g. "JSON Parse error: Unterminated string") tells
 * the model what went wrong but not how to fix it. This function augments
 * the error with a targeted hint based on the error pattern.
 */
export function diagnoseParseError(rawError: string): string {
  const hint = pickHint(rawError)
  return `${rawError}\n\nHint: ${hint}`
}

function pickHint(msg: string): string {
  if (msg.includes("Unterminated string")) {
    return 'Your JSON has an open string value that wasn\'t closed. Every string must end with a double-quote character ("). If your prompt parameter text is very long, ensure you add the closing " immediately after the final text character.'
  }
  if (msg.includes("Unexpected token") || msg.includes("Expected")) {
    return "Your JSON has a syntax error. Check for missing commas between fields, trailing commas (not allowed in JSON), or unquoted property names."
  }
  if (msg.includes("Unexpected end")) {
    return "Your JSON appears to be truncated. Ensure all objects are closed with } and all arrays with ]."
  }
  return 'Your JSON tool arguments are malformed. Double-check that all strings are quoted with ", objects closed with }, arrays closed with ], and there are no trailing commas.'
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
 * Close unterminated strings and unclosed brackets at EOF.
 *
 * Uses a state machine to track whether the cursor is inside a JSON
 * string and which brackets remain unclosed. At EOF, if we're still
 * inside a string, appends a closing ". Then appends missing ] and }
 * brackets in LIFO order (inner arrays before outer objects).
 *
 * This handles the common LLM truncation pattern where a long string
 * value near EOF loses its closing quote and the enclosing braces become
 * unbalanced.
 */
function closeOpenStructures(input: string): string {
  let inString = false
  let escaped = false
  const bracketStack: ("{" | "[")[] = []

  for (const ch of input) {
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === "\\") {
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === "{" || ch === "[") {
      bracketStack.push(ch)
    } else if (ch === "}") {
      if (bracketStack.at(-1) === "{") bracketStack.pop()
    } else if (ch === "]") {
      if (bracketStack.at(-1) === "[") bracketStack.pop()
    }
  }

  let result = input

  // Close unterminated string at EOF (not mid-escape)
  if (inString && !escaped) result += '"'

  // Close unclosed brackets in LIFO order (innermost first)
  while (bracketStack.length > 0) {
    result += bracketStack.pop()! === "{" ? "}" : "]"
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
