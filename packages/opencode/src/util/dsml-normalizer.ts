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

/** Degraded DSML double-pipe pattern: || or ｜｜ (with optional spaces) */
const _DOUBLE_PIPE = "(?:\\|\\s*\\||\uff5c\\s*\uff5c)"

/**
 * Canonical DSML token — full-width vertical bar U+FF5C.
 * The reference parser ONLY accepts this form.
 */
const CANONICAL_DSML = "\uff5cDSML\uff5c" // ｜DSML｜

export interface ExtractedToolCall {
  name: string
  input: string
}

/**
 * Normalize degraded DSML tokens in a stream chunk.
 * Converts ASCII/degraded pipe variants back to canonical full-width form.
 *
 * Handles:
 *   - Self-closing:  <||DSML||tagname/>
 *   - Opening:       <||DSML||tagname>
 *   - With attrs:    <||DSML||invoke name="x">
 *   - Closing:       </||DSML||tagname>
 */
export function normalizeDsmlTokens(chunk: string): string {
  // Pass 1: self-closing tags <||DSML||tagname/>
  chunk = chunk.replace(
    new RegExp(
      `<\\s*(/?)\\s*${_DOUBLE_PIPE}\\s*DSML\\s*${_DOUBLE_PIPE}\\s*([A-Za-z_][\\w]*)\\s*/\\s*>`,
      "g",
    ),
    (_match, slash, tag) => `<${slash}${CANONICAL_DSML}${tag}/>`,
  )
  // Pass 2: opening tags WITH attributes <||DSML||invoke name="x">
  chunk = chunk.replace(
    new RegExp(
      `<\\s*${_DOUBLE_PIPE}\\s*DSML\\s*${_DOUBLE_PIPE}\\s*([A-Za-z_][\\w]*)\\s+`,
      "g",
    ),
    (_match, tag) => `<${CANONICAL_DSML}${tag} `,
  )
  // Pass 3: opening/closing tags WITHOUT attributes
  chunk = chunk.replace(
    new RegExp(
      `<\\s*(/?)\\s*${_DOUBLE_PIPE}\\s*DSML\\s*${_DOUBLE_PIPE}\\s*([A-Za-z_][\\w]*)\\s*>`,
      "g",
    ),
    (_match, slash, tag) => `<${slash}${CANONICAL_DSML}${tag}>`,
  )
  return chunk
}

/** Same rule as Tool.canonicalName — avoid importing tool module (cycle risk). */
function toolKey(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "")
}

/**
 * Built-in provider tool ids (wire form). Used as default allowlist so prose like
 * `config{"a":1}` does not trigger disguised-tool retries. Plugin/MCP tools can
 * be passed via knownToolIds from the processor when available.
 */
export const DEFAULT_KNOWN_TOOL_IDS: ReadonlySet<string> = new Set(
  [
    "write",
    "edit",
    "multiedit",
    "applypatch",
    "read",
    "bash",
    "cmd",
    "run",
    "grep",
    "glob",
    "list",
    "webfetch",
    "task",
    "pipeline",
    "skill",
    "todowrite",
    "lsp",
    "planexit",
    "reasoninginenter",
    "reasoningexit",
    "memory",
    "universalsearch",
    "codegraph",
    "messagesearch",
    "dbread",
    "logsearch",
    "sessionread",
    "joboutput",
    "jobwait",
    "jobkill",
    "capability",
    "aicall",
    "compare",
    "treediff",
    "fossilgrep",
    "question",
    "invalid",
  ].map(toolKey),
)

/**
 * Union DEFAULT_KNOWN_TOOL_IDS with live wire names from this turn's tools record
 * (built-ins + plugin/MCP). Empty/missing tools → default only.
 */
export function knownToolIdsForTurn(tools?: Record<string, unknown> | null): ReadonlySet<string> {
  if (!tools || Object.keys(tools).length === 0) return DEFAULT_KNOWN_TOOL_IDS
  const set = new Set(DEFAULT_KNOWN_TOOL_IDS)
  for (const name of Object.keys(tools)) set.add(toolKey(name))
  return set
}

/**
 * Scan text for inline tool calls (name{...} patterns that look like
 * tool invocations embedded in plain text instead of structured tool_calls).
 * Returns null if no tool calls found.
 *
 * @param knownToolIds When set (including DEFAULT), only names in the set are
 *   extracted — reduces false positives on prose JSON. Pass `null` to accept any
 *   parseable name{...} (legacy / tests). Omit to use DEFAULT_KNOWN_TOOL_IDS.
 */
export function extractInlineToolCalls(
  text: string,
  knownToolIds?: ReadonlySet<string> | null,
): ExtractedToolCall[] | null {
  const matches: ExtractedToolCall[] = []
  const seen = new Set<string>()
  const allow = knownToolIds === null ? null : (knownToolIds ?? DEFAULT_KNOWN_TOOL_IDS)

  const regex = new RegExp(INLINE_TOOL_RE.source, "gi")
  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) {
    const name = m[1]!.toLowerCase()
    const input = m[2]!
    if (allow && !allow.has(toolKey(name))) continue

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
  knownToolIds?: ReadonlySet<string> | null,
): ExtractedToolCall[] | null {
  // Both "stop" and "length" can contain inline tool calls.
  // "stop" → model serialised tool call as text instead of structured.
  // "length" → truncated response may have partial inline tool call.
  if (finishReason !== "stop" && finishReason !== "length") return null
  if (!contentText || contentText.length < 10) return null
  return extractInlineToolCalls(contentText, knownToolIds)
}
