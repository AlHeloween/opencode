import { optionalPattern } from "./pattern"

/**
 * The uniform view an agent can ask for over any text a tool produces.
 *
 * Without it the only way to narrow output is to make the *command* narrow it —
 * `find … | grep …`, `| head -50`, `| sed -n '120,180p'` — which spends a shell
 * invocation on something the runtime already has in a string, and only works
 * for tools that run a shell at all.
 *
 * Every field is optional and they compose in one fixed order.
 */
export interface View {
  /** Keep only matching lines. */
  pattern?: string
  ignoreCase?: boolean
  /** Line range over what survived the pattern, 1-based inclusive: "120-180", "120-", "-180", "42". */
  lines?: string
  /** First N of what remains. */
  head?: number
  /** Last N of what remains. Applied after `head`, so both together take a window. */
  tail?: number
}

export interface ViewResult {
  text: string
  /** Lines in the input. */
  total: number
  /** Lines the pattern kept — equals `total` when no pattern was given. */
  matched: number
  /** Lines actually returned. */
  shown: number
}

/** Parse "120-180" | "120-" | "-180" | "42" into inclusive 1-based bounds. */
export function parseRange(spec: string): { from: number; to: number } {
  const trimmed = spec.trim()
  const match = /^(\d*)\s*-\s*(\d*)$/.exec(trimmed)
  if (!match) {
    const single = /^\d+$/.exec(trimmed)
    if (!single) throw new Error(`Invalid line range ${JSON.stringify(spec)}. Use "120-180", "120-", "-180" or "42".`)
    return { from: Number(trimmed), to: Number(trimmed) }
  }
  // An open end is the edge of the text, not zero: "-180" means "up to 180",
  // and reading it as 0..180 or 180..0 would silently return nothing.
  const from = match[1] === "" ? 1 : Number(match[1])
  const to = match[2] === "" ? Number.MAX_SAFE_INTEGER : Number(match[2])
  if (from < 1) throw new Error(`Invalid line range ${JSON.stringify(spec)}: lines are 1-based.`)
  if (to < from) throw new Error(`Invalid line range ${JSON.stringify(spec)}: end is before start.`)
  return { from, to }
}

/**
 * pattern → lines → head → tail.
 *
 * The order is the point. Filtering first means `lines` and `head`/`tail` count
 * *matches*, which is what someone asking for "the first 20 errors" means —
 * counting raw lines first would return the first 20 lines and however many
 * errors happened to be among them.
 */
export function applyView(text: string, view: View): ViewResult {
  const all = text.split("\n")
  const filter = optionalPattern(view.pattern, view.ignoreCase)
  const kept = filter ? all.filter((line) => filter.test(line)) : all

  const ranged = view.lines
    ? kept.slice(parseRange(view.lines).from - 1, Math.min(parseRange(view.lines).to, kept.length))
    : kept
  const headed = view.head !== undefined ? ranged.slice(0, Math.max(0, view.head)) : ranged
  const tailed = view.tail !== undefined ? headed.slice(-Math.max(0, view.tail) || headed.length) : headed

  return {
    text: tailed.join("\n"),
    total: all.length,
    matched: kept.length,
    shown: tailed.length,
  }
}

/** True when any field would actually change the output. */
export function isActive(view: View): boolean {
  return (
    (view.pattern !== undefined && view.pattern !== "") ||
    view.lines !== undefined ||
    view.head !== undefined ||
    view.tail !== undefined
  )
}

/**
 * One line telling the caller what it is looking at and how to get the rest.
 * A view that silently drops 900 of 1000 lines is how a partial answer gets
 * read as a complete one.
 */
export function describe(result: ViewResult, outputPath?: string): string {
  const parts = [`view: ${result.shown} of ${result.matched} matching line${result.matched === 1 ? "" : "s"}`]
  if (result.matched !== result.total) parts.push(`(${result.total} total)`)
  if (outputPath) parts.push(`— full output kept at ${outputPath}; re-read it with the read tool.`)
  return parts.join(" ")
}
