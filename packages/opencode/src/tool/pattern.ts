/**
 * Shared regex compilation for the history-reading tools.
 *
 * `grep`, `fossilgrep` and `logsearch` all take a pattern; the tools that read
 * conversation history did not, so the only way to find something in a session
 * was to page through it by offset. This is that missing filter.
 *
 * A malformed pattern is a user error with an obvious fix, not a defect: it
 * comes back as a message naming the pattern and the reason, so the caller can
 * correct it instead of reading a stack trace.
 */
export function compilePattern(pattern: string, ignoreCase?: boolean): RegExp {
  try {
    return new RegExp(pattern, ignoreCase ? "iu" : "u")
  } catch (cause) {
    // The non-unicode engine accepts patterns the `u` engine rejects, and for some of them it
    // gives them a DIFFERENT MEANING. That is harmless where the meaning does not move — `a{` is
    // an incomplete quantifier under `u` and a plain literal without it. It is NOT harmless for a
    // Unicode property: with `u`, `\p{Han}` is a property (and `Han` is a Script, so the lone form
    // is itself the syntax error that lands us here); without `u` it is the literal text
    // `p{Han}`, which matches nothing. Falling back would report a PATTERN ERROR as an EMPTY
    // RESULT — the one failure a caller cannot see. Measured 2026-09-30: `\p{Han}` and
    // `\p{Cyrillic}` both returned zero hits on a session full of Cyrillic while
    // `\p{Script=Han}` matched, and a search cycle was spent reading «the index has no CJK».
    if (/\\[pP]\{/.test(pattern)) {
      throw new Error(
        `Invalid regular expression ${JSON.stringify(pattern)}: ${cause instanceof Error ? cause.message : String(cause)}. ` +
          `A Unicode property must name what it is a property OF — write \\p{Script=Han}, not \\p{Han}.`,
      )
    }
    // Retry without `u` rather than refusing a pattern that plainly works elsewhere.
    try {
      return new RegExp(pattern, ignoreCase ? "i" : "")
    } catch {
      throw new Error(
        `Invalid regular expression ${JSON.stringify(pattern)}: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }
  }
}

/** Compile only when a pattern was given; undefined means "no filtering". */
export function optionalPattern(pattern: string | undefined, ignoreCase?: boolean): RegExp | undefined {
  return pattern === undefined || pattern === "" ? undefined : compilePattern(pattern, ignoreCase)
}
