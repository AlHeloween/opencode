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
    // `u` rejects some patterns the non-unicode engine accepts (lone `\d` in a
    // class is fine, but e.g. `\p` without a name, or an unescaped `{`). Retry
    // without it rather than refusing a pattern that plainly works elsewhere.
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
