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
export const KEYWORDS_MARKER = "Keywords:"
export const GOAL_HEADING = "## Goal"
/** How many weighted terms a navigation line carries — the axis, not the whole vector. */
export const KEYWORD_TOP_N = 3

export interface WeightedTerm {
  term: string
  weight: number
}

/**
 * The weighted terms of the LAST `Keywords:` line in a message's own text, or undefined.
 *
 * Two rules, each bought by a sample rather than assumed (probe of 1134 carriers:
 * `experiments/2026-09-22_sv-keyword-quality/probe.py`):
 *   - read from the LEFT and STOP at the first chunk that is not `term weight`. 16 carriers keep
 *     THINKING after the vector («… wait — weights must sum 1.0», «## Что выяснил по логам»); a
 *     reader that scans on absorbs that prose as terms, which is how an invented vector enters
 *     memory. Multi-word terms are real traffic («provider auth 0.30»), so the term is everything
 *     before the last number — an earlier single-word matcher reported a false 36% failure rate.
 *   - NO renormalisation. Weights are reported as written: 927/950 sum to 1.0, and the rest are
 *     truncated vectors that must not be made to look complete.
 *
 * The LAST marker wins, for the same measured reason `extractMessageDominant` documents: an answer
 * may QUOTE the format (a plan, a summary, the kernel text) before writing its own vector.
 */
export function extractKeywords(text: string): WeightedTerm[] | undefined {
  const at = text.lastIndexOf(KEYWORDS_MARKER)
  if (at < 0) return undefined
  const line = text.slice(at + KEYWORDS_MARKER.length).split("\n")[0] ?? ""
  const terms: WeightedTerm[] = []
  for (const chunk of line.split(",")) {
    const match = chunk.trim().match(/^(.+?)\s+([0-9]*\.?[0-9]+)[.;]?$/)
    if (!match) break
    terms.push({ term: match[1]!.trim(), weight: Number(match[2]) })
  }
  return terms.length > 0 ? terms : undefined
}

/**
 * The chain a vector declares about itself: its own `md5` and the `prev-md5` it points back to.
 *
 * ADID 12.2 §I.14.3.1 asks for exactly this — «if the Content Window shifted then perform reverse
 * search via #semantic_link» — and the link is not something a reader must compute: the model
 * WRITES it next to the vector. What was missing was the read. Measured on this session's rows
 * (`experiments/2026-09-22_sv-delta/calibrate.py`): 668 links intact, 133 broken, 68 chain-starts —
 * so a break DISCRIMINATES, unlike ΔSV over the weighted terms, which saturates (median 2.8-style
 * max out of a 0..2 range, because consecutive messages share no terms at all: the terms are a
 * fingerprint of the moment, not a point in a shared space).
 *
 * Both fields are anchored to the START OF THEIR OWN LINE, and that anchoring is the whole
 * difference between a measurement and an artefact: the first version of the probe used
 * `rfind("md5:")`, whose last occurrence is inside `parent-goal-md5:`, and reported an 86%
 * broken chain that was pure instrument error. The LAST occurrence per field wins, for the same
 * reason `extractKeywords` documents: an answer may quote a vector before writing its own.
 */
export function extractVectorChain(text: string): { md5?: string; prevMd5?: string; parentGoalMd5?: string } {
  // The canonical form is 32 hex with NO other character (@SV_FORMAT). This project's own rows ALSO
  // carry a spaced form — `16hex 16hex` — and that is not a curiosity: measured on this session,
  // the last ten vectors all have it, so their own md5 was unreadable and the chain marker built on
  // top of it silently did nothing (an unreadable side is UNKNOWN, and unknown is never marked: «a
  // missing field is not a break»). The reader therefore accepts both and normalises to the
  // canonical form; the WRITER's form stays the canonical one.
  const hex32 = (field: string) => {
    const pattern = new RegExp(`^${field}:\\s*${HEX32_SOURCE}`, "gm")
    return [...text.matchAll(pattern)].at(-1)?.[1]?.replace(/\s+/g, "")
  }
  const own = hex32("md5")
  const previous = hex32("prev-md5")
  // The third field of @SV_FORMAT: the vector's link to the PLAN it works under. Read here, with the
  // same anchoring, because the anchoring is what keeps `md5:` from being read out of
  // `parent-goal-md5:` — the instrument error that once produced an 86% broken chain.
  const parentGoal = hex32("parent-goal-md5")
  return {
    ...(own ? { md5: own } : {}),
    ...(previous ? { prevMd5: previous } : {}),
    ...(parentGoal ? { parentGoalMd5: parentGoal } : {}),
  }
}

/** One entry of the plan map in `memory/reasoning.md`: a plan, and the md5 label its vector carries. */
export interface PlanMapEntry {
  plan: string
  label: string
}

/**
 * Read the PLAN MAP as it is written in memory: a plan path in backticks, then that block's `md5:`.
 *
 * The map is written BY HAND on every fold (owner, 2026-09-22: «Раз мы убрали summary — мы обязаны
 * заполнять и сопровождать эту форму в memory»), so nothing but a read can check it. A block with no
 * `md5:` line — the ratchet list — contributes no entry: an unlabelled plan is not a link, and this
 * reader must not invent one for it.
 */
export function parsePlanMap(memory: string): PlanMapEntry[] {
  const entries: PlanMapEntry[] = []
  let named: string | undefined
  for (const line of memory.split("\n")) {
    const plan = line.match(/`(plans\/[^`]+\.md)`/)
    if (plan) {
      named = plan[1]!
      continue
    }
    // The map is a markdown LIST, so its label lines are INDENTED (`  md5: …`). A `^md5:` anchor
    // matched NOTHING in the live memory (measured 2026-09-23: `^md5:` -> no matches,
    // `^[ \t]+md5:` -> 3), which left `labels` empty and reported every non-zero `parent-goal-md5`
    // as off-plan. The watcher's first live finding was its own bug, not a vector's.
    const label = line.match(new RegExp(`^[ \\t]*md5:\\s*${HEX32_SOURCE}`))
    if (label && named) {
      entries.push({ plan: named, label: label[1]!.replace(/\s+/g, "") })
      named = undefined
    }
  }
  return entries
}

/**
 * THE COUPLING WATCHER (owner, 2026-09-22): «alerter … will follow messages in compact — their md5
 * actually… сцепление memory и всего остального контента». With generation removed nothing produces
 * that linkage, so it has to be CHECKED rather than hoped for: a vector that names a parent plan
 * nobody declared is floating free, and a map entry that names a plan file which does not exist is a
 * link into nothing. Both are reported with the address that opens them.
 *
 * `checked` is returned as well as the findings, because a silent check is indistinguishable from no
 * check — the same rule this project applies to every instrument that shortens its own output.
 */
export function couplingFindings(input: {
  /** The window's messages, in order, with the text that carries their vectors. */
  messages: readonly { id: string; text: string }[]
  /** The map as written in memory (`parsePlanMap`). */
  map: readonly PlanMapEntry[]
  /** Plan paths that exist on disk, worktree-relative, exactly as the map writes them. */
  plans: ReadonlySet<string>
}): { checked: number; findings: string[] } {
  const labels = new Set(input.map.map((entry) => entry.label))
  const findings: string[] = []
  let checked = 0
  for (const message of input.messages) {
    const parent = extractVectorChain(message.text).parentGoalMd5
    // No link declared, or the all-zero hash that opens a chain: nothing to couple, nothing to say.
    if (!parent || parent === EMPTY_HASH) continue
    checked++
    if (!labels.has(parent)) {
      findings.push(
        `vector-off-plan ${message.id} → parent-goal-md5 ${parent} is not a label in the plan map`,
      )
    }
  }
  for (const entry of input.map) {
    if (!input.plans.has(entry.plan)) {
      findings.push(`map-names-missing-plan ${entry.plan} (label ${entry.label}) has no file on disk`)
    }
  }
  return { checked, findings }
}

/** The all-zero hash a vector uses to say «I open a chain» — absence of a predecessor, not a break. */
export const EMPTY_HASH = "00000000000000000000000000000000"

/**
 * Every written form of a 32-hex label this project has produced, as ONE source: contiguous,
 * `16+16`, and `8×4`.
 *
 * The third form is not hypothetical — it is how the plan MAP is written in memory, and the reader
 * that only knew the first two would have called every vector in it off-plan: an alerter that alarms
 * on everything is an alerter nobody reads. Measured while wiring the watcher, 2026-09-22: the map's
 * labels are `a7f3c1e0 d95b4826 f1a0c3e7 8b2d6405`, the turn vectors' are `7a2c95e1b0d34f68
 * 4e18b0c7a9d3265f`, and both are the same kind of label. The reader accepts what the writers write;
 * the CANONICAL form stays the contiguous one.
 */
const HEX32_SOURCE =
  "([0-9a-f]{32}|[0-9a-f]{16}\\s+[0-9a-f]{16}|[0-9a-f]{8}\\s+[0-9a-f]{8}\\s+[0-9a-f]{8}\\s+[0-9a-f]{8})"

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
  /** The message's own weighted terms, as written. Rendered as the TOPIC AXIS of the epoch. */
  keywords?: readonly WeightedTerm[]
  role?: string
  partType?: string
  messageID: string
  partID: string
}): string {
  const dominant = input.dominant ? `"${input.dominant}"` : "(no dominant)"
  const keywords =
    input.keywords && input.keywords.length > 0
      ? ` \u00b7 kw: ${input.keywords
          .slice(0, KEYWORD_TOP_N)
          .map((entry) => `${entry.term} ${entry.weight}`)
          .join(", ")}`
      : ""
  const kind = [input.role, input.partType].filter((part) => part && part.length > 0).join("/")
  return `#${input.messageIndex} ${dominant}${keywords} \u00b7 ${kind || "?"} \u00b7 ${input.messageID} \u00b7 ${input.partID}`
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
