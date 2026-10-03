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
export function extractVectorChain(text: string): { md5?: string; prevMd5?: string; parentGoalMd5?: string } {  // The canonical form is 32 hex with NO other character (@SV_FORMAT). This project's own rows ALSO
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

/**
 * The `md5:` line's RAW value, unvalidated, or undefined when the line is absent.
 *
 * `extractVectorChain` answers "is there a usable hash?" and a malformed one is silently the same
 * as a missing one. That silence costs the cheapest self-check a model can leave: measured on this
 * session's own rows (2026-09-27), two vectors carried a non-hex fragment INSIDE the hash —
 * `b7e93f0a5c26d8エラー` (a generation artifact that also ate the head of the next line) and
 * `…b2f38m45` (one letter). Both are situational rather than random, so the fragment names the
 * state the model was in: the `エラー` row is the turn where the mermaid render failed.
 *
 * @SV_FORMAT forbids computing or verifying the digest — 32 hex is the only admissible form, and
 * whether those 32 characters are RANDOM is not decidable from the text. So this reader never
 * judges a well-formed hash. It only separates "the field is not there" from "the field is there
 * and it is not 32 hex", which is the difference between a missing edge and a reported bug.
 */
export function readRawVectorField(text: string, field: string): string | undefined {
  // Measured 2026-09-27: the stored text keeps its newlines as LITERAL two-character sequences
  // (`\n`), so a plain `^field:` anchor with the `m` flag never finds a line start after the first
  // one, and `.*` runs on into the following fields. That is how a clean 32-hex label was reported
  // as `leaked "…"` three times in one row: the "value" had swallowed `prev-md5` and
  // `parent-goal-md5`, was entirely hex, was longer than 32, and the fallback sliced 32 of it.
  //
  // So the line start is EITHER kind of break, and the value stops at either kind. Both are
  // accepted because a reader that only knows one form silently reports the other as malformed.
  const at = [...text.matchAll(new RegExp(`(?:^|\\\\n|\\n)${field}:[ \\t]*(.*?)(?=\\\\n|\\n|$)`, "g"))].at(-1)
  const value = at?.[1]?.trim()
  return value ? value : undefined
}

/** The non-hex fragment inside a raw `md5:` value, or undefined when the value is clean 32-hex. */
export function malformedFragment(value: string | undefined): string | undefined {
  if (value === undefined) return
  if (/^[0-9a-fA-F]{32}$/.test(value)) return
  const run = value.match(/[^0-9a-fA-F]+/)
  // A value that is all hex but LONGER than 32 is not a leaked token — it is a reader that ran
  // past the field. Reporting its first 32 characters named a clean label as a leak, which is the
  // class of error this whole section exists to remove: an instrument that cannot tell two
  // explanations apart. Unknown, and said so, beats a confident wrong name.
  if (!run) return
  return run[0]
}

/**
 * An `@SV_TARGET` block's weights, when the text carries one.
 *
 * Steering a sub-agent's attention is the kernel's `SEMANTIC_CONTROL`, and its stated instrument is
 * `@L1_DISTANCE` between the target and the returned vector. That distance is ARITHMETIC over the
 * two weight lists, so a `s` row that carries BOTH sides makes the steering verifiable with no model
 * call: read the ask out of the task binding, read the answer out of the reply, subtract. Without
 * both in one row they live in different messages and the check is a recollection.
 *
 * `classifyText` in `session/semantic-vector.ts` is NOT this: it is a fixed ten-topic classifier that
 * ranks FTS5 hits, and it never sees `@SV_FORMAT`.
 */
export function extractSvTarget(text: string): WeightedTerm[] | undefined {
  const at = text.lastIndexOf("@SV_TARGET")
  if (at < 0) return undefined
  return extractKeywords(text.slice(at))
}

/** One entry of the plan map the CALLER built: a plan path, and the md5 label that plan declares. */
export interface PlanMapEntry {
  plan: string
  label: string
}

// `parsePlanMap` stood here until 2026-10-01 (plan L3). It read the map hand-kept in
// `memory/reasoning.md`, and that file held ZERO `md5:` lines — so the label set came out empty and the
// watcher reported every non-zero `parent-goal-md5` as off-plan: true statements about a DEAD INPUT,
// every turn. Labels now come from each plan's OWN header (`util/plan-status.ts` → `planLabels` →
// `planHeaderLabel`), which is the file that IS the plan. What it still pinned survives as assertions in
// `test/session/vector-coupling.test.ts`: the indented and the unindented header forms, and the spaced
// label as a VECTOR carries it.

/**
 * A plan's OWN label, read from the plan file — one label, one place.
 *
 * The map it replaces was hand-kept in `memory/reasoning.md`, MEASURED (2026-10-01) to hold ZERO
 * `md5:` lines: `labels` came out empty, so the watcher reported every non-zero `parent-goal-md5` as
 * off-plan — 15 findings in one session, each a true statement about a DEAD INPUT. A plan already
 * declares its label once, in its own `@SV_FORMAT` header, in the file that IS the plan; that is the
 * source this reads, so there is no second copy to keep in step.
 *
 * The anchor and the normalisation are the removed reader's, verbatim, for the reason it stated: the header
 * is fenced YAML inside markdown, so the line may be indented, and `prev-md5:` / `parent-goal-md5:` must
 * never be read as the label — neither starts with `md5:`. The FIRST match wins: a header comes first by
 * construction, so first-wins is what makes the header the owner and a quoted vector a copy.
 */
export function planHeaderLabel(text: string): string | undefined {
  for (const line of text.split("\n")) {
    const label = line.match(new RegExp(`^[ \\t]*md5:\\s*${HEX32_SOURCE}`))
    if (label) return label[1]!.replace(/\s+/g, "")
  }
  return undefined
}

/**
 * THE COUPLING WATCHER (owner, 2026-09-22): «alerter … will follow messages in compact — their md5
 * actually… сцепление memory и всего остального контента». With generation removed nothing produces
 * that linkage, so it has to be CHECKED rather than hoped for: a vector that names a parent plan
 * nobody declared is floating free, and a map entry that names a plan file which does not exist is a
 * link into nothing. Both are reported with the address that opens them.
 *
 * ONE AXIS, THREE CARRIERS (plan S5): every declared reference to a plan must RESOLVE — a vector's
 * `parent-goal-md5` into the map's labels, a map entry's path into the files on disk, a stored
 * manifest's `plan:` into the plan it was keyed by. The carriers differ; the QUESTION does not, which
 * is why they share one line rather than getting three. Each finding names its own carrier, so a
 * reader knows which writer to go and fix, and one line keeps one predicate from passing on one
 * carrier while quietly rotting on another.
 *
 * `checked` is returned as well as the findings, because a silent check is indistinguishable from no
 * check — the same rule this project applies to every instrument that shortens its own output.
 * `manifests` is carried SEPARATELY for the same reason: it counts a different population (what the
 * store was asked about), and one number must not answer two questions.
 */
export function couplingFindings(input: {
  /** The window's messages, in order, with the text that carries their vectors. */
  messages: readonly { id: string; text: string }[]
  /** The map as the CALLER built it. Production reads each plan's own header (`util/plan-status.ts` →
   *  `planLabels` → `planHeaderLabel`); the reader that used the hand-kept memory map was removed
   *  2026-10-01 (plan L3) once that file was measured to hold zero `md5:` lines. */
  map: readonly PlanMapEntry[]
  /** Plan paths that exist on disk, worktree-relative, exactly as the map writes them. */
  plans: ReadonlySet<string>
  /** THE STORE'S OWN ANSWER (plan S5, `SVM.orphanManifests`): how many manifests were looked at, and
   *  the ones whose ref no longer resolves. Resolved where the store lives, so this stays pure. */
  manifests: {
    checked: number
    orphans: readonly { plan: string; task: string; reason: "moved" | "deleted" }[]
  }
}): { checked: number; manifests: number; findings: string[] } {
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
  // THE STORE'S CARRIER (plan S5): the plan these records were keyed by is not on disk any more, so no
  // plan-by-plan walk can reach them and nothing else in the runtime would ever say it. The REASON rides
  // the finding because the remedies differ — update the ref, or accept that the record outlived its task.
  for (const orphan of input.manifests.orphans) {
    findings.push(
      `manifest-names-missing-plan ${orphan.plan} ${orphan.task} has no file on disk — the record outlived its plan (${orphan.reason.toUpperCase()})`,
    )
  }
  return { checked, manifests: input.manifests.checked, findings }
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

/** How many non-empty trailing lines a `@SV_FORMAT` block may occupy. */
const VECTOR_TAIL_LINES = 8

/**
 * The reply's TAIL, presentation stripped — where a `@SV_FORMAT` block is written (the contract
 * says «at the END of every reply»).
 *
 * WHY the strip, and why the tail: the same block is written plainly, inside `backticks`, or inside
 * a fenced code block — a reader that knows ONE form declares every other form ABSENT, which is
 * exactly the defect the coupling watcher shipped with (labels written `8×4`, vectors `16+16`, a
 * reader that accepted neither). Reading the TAIL is also what keeps a QUOTED vector from counting
 * HERE: a reply that cites someone else's block in its middle does not carry one of its own.
 */
function vectorTail(text: string): string {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(-VECTOR_TAIL_LINES)
    .map((line) => line.replace(/^[^\w]*/, ""))
    .join("\n")
}

/**
 * The @SV_FORMAT SIGNATURE — the lines a semantic vector always carries, read AT THE END of the text
 * with the presentation stripped.
 *
 * Same tail, the COMPLETENESS question: `@CURRENT_SV` (`statusVector`) and the delegate report
 * (`tool/task.ts`) read THIS one, because a reply whose block carries no `md5` is the state they
 * exist to name. Whether the reply declares a dominant AT ALL is the other, looser question —
 * `extractMessageDominant` below, which reads the field line wherever the reply wrote it.
 */
export function hasSemanticVector(text: string): boolean {
  const tail = vectorTail(text)
  return /^Keywords:/m.test(tail) && /^Semantic dominant:/m.test(tail) && /^md5:/m.test(tail)
}

/** The `@SV_FORMAT` field this reader reads, as the start of the reply's OWN line. */
const SEMANTIC_DOMINANT_FIELD = "Semantic dominant:"

/**
 * The dominant of a MESSAGE's own text, or undefined when the reply declares none.
 *
 * ONE predicate for «this reply carries a vector»: the reply must WRITE THE FIELD — a line of its
 * own whose start (presentation stripped) is `Semantic dominant:` — and the reader takes the LAST
 * such line, because an answer quotes other vectors (the spine it just read, a plan, a summary)
 * before writing its own. Two measured samples hold this shape: 2026-09-20, 223 non-machinery parts
 * carry the marker and 16 of them carry more than one.
 *
 * A reply that only MENTIONS the field declares nothing. The measured poison (2026-10-02) is a prose
 * line — «`docs/compaction.md:552` содержит `Semantic dominant: One line of what this vector is
 * about.`» — where the field sits INSIDE a sentence, in inline code. Over the whole `memory.db` that
 * day: 417 assistant text parts contain the marker, this predicate admits 416, and the single one it
 * drops is that reply. A tail-window variant drops 15, fourteen of them real blocks written before
 * the reply's closing paragraph — the field LINE, not a position, is the discriminator.
 */
export function extractMessageDominant(text: string): string | undefined {
  const lines = text.split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    const field = (lines[i] ?? "").replace(/^[^\w]*/, "")
    if (!field.startsWith(SEMANTIC_DOMINANT_FIELD)) continue
    const value = unquote(field.slice(SEMANTIC_DOMINANT_FIELD.length))
    return value.length > 0 ? value : undefined
  }
  return undefined
}

/**
 * The signature a SNAPSHOT carries when the reply it closes wrote a vector — one token, the vector's
 * own address plus what it is about.
 *
 * WHY THE COMMIT SIGNS ITSELF (owner, 2026-10-03). `@CURRENT_SV` is a rule in the middle of the
 * static prefix, and an instruction's POSITION in the window is part of its strength: the emission
 * was measured obeying at prompt 352 776 and gone at 389 893 and 498 315. A reminder in the tail
 * note treats the symptom and rides the same window that is failing. The signature treats the
 * cause — it makes the vector the ADDRESS of a durable artefact, so a reply that omitted it leaves
 * its snapshot unsigned and `fossilgrep sv:<md5>` cannot find the work, which is a fact the next
 * turn can read rather than a rule it has to remember.
 *
 * Returns undefined when the reply declared no vector. An unsigned snapshot is not a broken one —
 * most turns write files without closing on a vector — so this is a signature, not a gate.
 */
export function vectorSign(text: string | undefined): string | undefined {
  if (!text || !hasSemanticVector(text)) return undefined
  const { md5 } = extractVectorChain(text)
  if (!md5) return undefined
  const dominant = extractMessageDominant(text)
  const about = dominant ? ` dominant=${dominant.replace(/\s+/g, " ").slice(0, 80)}` : ""
  return `sv:${md5}${about}`
}
