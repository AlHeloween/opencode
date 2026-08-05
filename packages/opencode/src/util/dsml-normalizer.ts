/**
 * DeepSeek V4 Pro tool-call normalization.
 *
 * Known bug (deepseek-ai/DeepSeek-V3#1244): the model intermittently emits
 * tool calls as plain text instead of the structured tool_calls field:
 *   1. Degraded DSML tokens: <||DSML||tool_calls> (ASCII ||) instead of
 *      canonical <｜DSML｜tool_calls> (full-width ｜). The parser rejects these.
 *   2. Inline JSON in content: finish_reason="stop" but content contains
 *      tool_name{...} — the tool call was embedded in text, not structured.
 *
 * Fix:
 *   Level 1: Normalize degraded DSML tokens in stream chunks.
 *   Level 2: After finish-step with reason="stop", scan content for disguised
 *            tool calls and extract them.
 */

/** Inline tool-call pattern: name followed by JSON object/array. */
const INLINE_TOOL_RE = /(?:^|\s)([a-z_][\w]*)\s*(\{(?:[^{}]|\{[^{}]*\})*\})/gi

/** Degraded DSML token: <||DSML||tag> or <｜｜DSML｜｜tag> → canonical <｜DSML｜tag> */
const DEGRADED_DSML_RE = /<\s*(\/?)\s*(?:\|\s*\||｜\s*｜)\s*DSML\s*(?:\|\s*\||｜\s*｜)\s*([A-Za-z_][\w]*)\s*>/g
const CANONICAL_DSML = "｜DSML｜"

export interface ExtractedToolCall {
  name: string
  input: string
}

/**
 * Normalize degraded DSML tokens in a stream chunk.
 * Converts <||DSML||tag> → <｜DSML｜tag>
 */
export function normalizeDsmlTokens(chunk: string): string {
  return chunk.replace(DEGRADED_DSML_RE, (_match, slash, tag) => {
    return `<${slash}${CANONICAL_DSML}${tag}>`
  })
}

/**
 * Scan text for inline tool calls (name{...} patterns that look like
 * tool invocations embedded in plain text instead of structured tool_calls).
 * Returns null if no tool calls found.
 */
export function extractInlineToolCalls(text: string): ExtractedToolCall[] | null {
  const matches: ExtractedToolCall[] = []
  const seen = new Set<string>()

  const regex = new RegExp(INLINE_TOOL_RE.source, "gi")
  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) {
    const name = m[1]!.toLowerCase()
    const input = m[2]!
    // Skip if this exact call was already extracted
    const key = `${name}:${input}`
    if (seen.has(key)) continue
    seen.add(key)

    // Only extract if it looks like a valid tool call (JSON parseable)
    try {
      const parsed = JSON.parse(input)
      if (typeof parsed === "object" && parsed !== null) {
        matches.push({ name, input })
      }
    } catch {
      // Not valid JSON — skip. Real tool calls will have parseable JSON.
    }
  }

  return matches.length > 0 ? matches : null
}

/**
 * Check if finish_reason="stop" but content has disguised tool calls.
 * Returns extracted tool calls if found, null otherwise.
 */
export function detectDisguisedToolCalls(
  finishReason: string,
  contentText: string,
): ExtractedToolCall[] | null {
  if (finishReason !== "stop") return null
  if (!contentText || contentText.length < 10) return null
  return extractInlineToolCalls(contentText)
}
