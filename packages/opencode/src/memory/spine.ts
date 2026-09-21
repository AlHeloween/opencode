/**
 * The session's memory spine — one line per epoch, taken from summary bodies.
 *
 * This is not an index and needs no store. A compaction summary repeats the semantic dominant
 * the model already wrote for that window (`@SV_FORMAT` writes it at the end of every answer),
 * so the whole spine of a long session is a SUBSTRING of rows that already exist.
 *
 * Measured 2026-09-20 on this session: 59 epochs, every one carrying the marker, 4 248
 * characters for all of them — against ~100 k tokens for one raw snapshot of the same window.
 * That ratio is the reason navigation is possible at all: the spine costs 1/80 of the thing it
 * stands for, so an agent can afford to read the whole table of contents before choosing.
 *
 * Extraction is deliberately literal. A malformed or missing block yields no line for that
 * epoch, which is a smaller error than an invented one, and nothing here validates the vector
 * against `@SV_FORMAT` — that gap is named in the plan rather than papered over.
 */

export const DOMINANT_MARKER = "dominant:"
export const GOAL_HEADING = "## Goal"

function unquote(text: string): string {
  const trimmed = text.trim()
  const pairs: [string, string][] = [
    ['"', '"'],
    ["'", "'"],
    ["\u201c", "\u201d"],
    ["\u00ab", "\u00bb"],
  ]
  for (const [open, close] of pairs) {
    if (trimmed.startsWith(open) && trimmed.endsWith(close) && trimmed.length >= 2) {
      return trimmed.slice(open.length, trimmed.length - close.length).trim()
    }
  }
  return trimmed
}

/**
 * The dominant of a summary body, or undefined when the body carries no vector.
 *
 * The FIRST marker wins: in these rows the vector block sits at the head of the body, so the
 * first occurrence is the epoch's own dominant and a later one would be a quotation of someone
 * else's.
 */
export function extractDominant(body: string): string | undefined {
  const at = body.indexOf(DOMINANT_MARKER)
  if (at < 0) return undefined
  const line = body.slice(at + DOMINANT_MARKER.length).split("\n")[0] ?? ""
  const value = unquote(line)
  return value.length > 0 ? value : undefined
}

/** The head of `## Goal` — its first non-empty, non-heading line. */
export function extractGoal(body: string): string | undefined {
  const at = body.indexOf(GOAL_HEADING)
  if (at < 0) return undefined
  const head = body
    .slice(at + GOAL_HEADING.length)
    .split("\n")
    .find((line) => line.trim().length > 0 && !line.trimStart().startsWith("#"))
  return head?.trim() || undefined
}

/**
 * One spine line. The address travels with the line, because the second query needs it: an
 * excerpt without an address cannot be re-acquired once the source is released.
 */
export function spineLine(input: {
  ordinal: number
  dominant?: string
  agent?: string
  modelID?: string
  id: string
  fromMessageID: string
  toMessageID: string
}): string {
  const dominant = input.dominant ? `"${input.dominant}"` : "(no dominant)"
  const meta = [input.agent, input.modelID, input.id, `${input.fromMessageID}..${input.toMessageID}`]
    .filter((part) => part && part.length > 0)
    .join(" \u00b7 ")
  return `${input.ordinal}. ${dominant} \u00b7 ${meta}`
}

/**
 * The address the spine prints — `from..to` — read back into its two ids.
 *
 * This is what makes the descent possible: the first query prints the address, the second
 * feeds it back verbatim. A single id is accepted as a one-message range; a malformed value
 * returns undefined so the caller can say so instead of silently searching everything.
 */
export function parseRange(range: string): { from: string; to: string } | undefined {
  const parts = range.trim().split("..")
  if (parts.length === 1) {
    const only = parts[0]?.trim()
    return only ? { from: only, to: only } : undefined
  }
  if (parts.length !== 2) return undefined
  const from = parts[0]?.trim()
  const to = parts[1]?.trim()
  if (!from || !to) return undefined
  return { from, to }
}

/**
 * One message-level line: the dominant a message carries, with the address of the part that
 * carries it. The level-3 counterpart of `spineLine` — same idea, one order of magnitude down.
 */
export function dominantLine(input: {
  messageIndex: number
  dominant?: string
  role?: string
  partType?: string
  messageID: string
  partID: string
}): string {
  const dominant = input.dominant ? `"${input.dominant}"` : "(no dominant)"
  const kind = [input.role, input.partType].filter((part) => part && part.length > 0).join("/")
  return `#${input.messageIndex} ${dominant} \u00b7 ${kind || "?"} \u00b7 ${input.messageID} \u00b7 ${input.partID}`
}

/**
 * The ordinal a caller meant by `epoch`, or undefined when they meant "not set".
 *
 * The ordinal is 1-based, so 0 and every negative number are ABSENCES, not requests. A model that
 * fills an optional number with 0 must get the spine — not «No epoch 0», which is a turn lost to a
 * defect rather than to a mistake (found by an outside call testing this mechanism on its own
 * history, 2026-09-21). Non-integers truncate rather than matching an epoch nobody has.
 */
export function epochOrdinal(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  const ordinal = Math.trunc(value)
  return ordinal >= 1 ? ordinal : undefined
}

/**
 * What opening one epoch prints BEFORE its body: the address, its standing, and the exact call that
 * descends into it.
 *
 * The range used to have to come from the compaction anchor instead of from this answer (same
 * outside call, 2026-09-21) — an address the caller must reconstruct is an address the mechanism
 * did not give. `info_mark` states the asymmetry that call confirmed on its own history: ids and
 * ranges are Exact, the body is model prose, and a LATER epoch may have refuted it.
 */
export function epochOpen(input: {
  id: string
  fromMessageID: string
  toMessageID: string
  body: string
}): string {
  return [
    `checkpoint_id: \`${input.id}\``,
    `from_id: \`${input.fromMessageID}\`  to_id: \`${input.toMessageID}\``,
    "info_mark: ids and ranges Exact — the body is Inferred model prose, and a later epoch may have refuted it.",
    `descend: messagesearch { corpus: "parts", dominants: true, range: "${input.fromMessageID}..${input.toMessageID}" }`,
    "",
    input.body,
  ].join("\n")
}

/**
 * The dominant of a MESSAGE's own text, or undefined when it carries none.
 *
 * The LAST marker wins here — the asymmetry with `extractDominant` is measured, not a taste.
 * An answer quotes other dominants (the spine it just read, a plan, a summary), while its own
 * vector block is written at the very end. Measured 2026-09-20 on the owner session: 223
 * non-machinery parts carry the marker and 16 of them carry more than one.
 */
export function extractMessageDominant(text: string): string | undefined {
  const at = text.lastIndexOf(DOMINANT_MARKER)
  if (at < 0) return undefined
  const line = text.slice(at + DOMINANT_MARKER.length).split("\n")[0] ?? ""
  const value = unquote(line)
  return value.length > 0 ? value : undefined
}
