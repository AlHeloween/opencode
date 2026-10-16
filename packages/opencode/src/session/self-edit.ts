import { createHash } from "crypto"
import { configValue } from "@opencode-ai/core/flag/flag"

/**
 * Self-edit directive (t70 P1): the agent narrows its OWN replayed
 * representation — CUT removes lines, ERRATUM appends a correction to an
 * anchor line. Pure functions over a line view: the stored original is
 * never touched here (that invariant lives with the caller in P1b).
 *
 * Addressing, measured in Phase E (tags 78%, snippets-resolved 78%,
 * numbers-implied 48%): tags and unique snippets resolve, bare numbers
 * only advise. A mismatch refuses instead of guessing.
 *
 * Signed thinking of the last turn inside an active tool-use loop rides
 * verbatim (E5 wire evidence); a cut reaching into it is refused and the
 * range stands. The directive takes effect at the next turn boundary.
 */

export type LineKind = "text" | "call" | "signed" | "meta" | "attachment"

export type ViewLine = {
  number: number
  tag: string
  text: string
  kind: LineKind
}

export type CutTarget = "lines" | "call"

export type Cut = {
  from: number
  to: number
  tagFrom?: string
  tagTo?: string
  startSnippet?: string
  endSnippet?: string
  target?: CutTarget
}

export type Erratum = {
  after: number
  text: string
}

export type Directive = {
  targetMd5: string
  cuts: Cut[]
  errata: Erratum[]
  reason: string
  signed: "keep" | "cut"
}

export type Refusal = { ok: false; error: string }

type Ok<T> = { ok: true } & T

const MD5_PATTERN = /^[0-9a-f]{32}$/
const TAG_PATTERN = /^[0-9a-f]{8}$/

/** A real content hash of the stored message — an address, not a label. */
export function messageMd5(text: string): string {
  return createHash("md5").update(text, "utf8").digest("hex")
}

/** The switch (OFF unless enabled — P1b reads this) with priority env > config (t76-minimum). */
export function isSelfEditEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env["OPENCODE_SELF_EDIT_DIRECTIVE"]
  if (raw !== undefined && raw.trim() !== "") {
    const value = raw.toLowerCase()
    return value === "true" || value === "1"
  }
  const cfg = configValue("OPENCODE_SELF_EDIT_DIRECTIVE")
  if (typeof cfg === "boolean") return cfg
  return false
}

export const SELF_EDIT_ENABLED = isSelfEditEnabled()

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1)
  return trimmed
}

function parseRange(raw: string): { from: number; to: number } | undefined {
  const match = raw.trim().match(/^(\d+)\s*-\s*(\d+)$/)
  if (!match) return undefined
  return { from: Number(match[1]), to: Number(match[2]) }
}

/**
 * Strict line grammar (the shape Phase E measured):
 *
 *   EXCERPT <32-hex md5>
 *   CUT lines: A-B            (repeatable; `none` = no cuts)
 *   CUT tags: HHHHHHHH-HHHHHHHH
 *   CUT start: "..." / CUT end: "..."
 *   REASON: ...               (required, non-empty)
 *   SIGNED: keep | cut
 *   ERRATUM after N: ...      (repeatable)
 *
 * Anything else is malformed and refuses — fail-closed.
 */
export function parseDirective(raw: string): Ok<{ directive: Directive }> | Refusal {
  const fail = (error: string): Refusal => ({ ok: false, error: `self-edit directive refused: ${error}` })
  const cuts: Cut[] = []
  const errata: Erratum[] = []
  let targetMd5: string | undefined
  let reason: string | undefined
  let signed: Directive["signed"] | undefined
  let current: Cut | undefined
  const flush = () => {
    if (current) cuts.push(current)
    current = undefined
  }
  for (const row of raw.split("\n")) {
    const line = row.trim()
    if (line === "") continue
    if (line.startsWith("EXCERPT ")) {
      const hash = line.slice("EXCERPT ".length).trim()
      if (!MD5_PATTERN.test(hash)) return fail(`target ${JSON.stringify(hash)} is not a 32-hex message hash`)
      targetMd5 = hash
      continue
    }
    if (line === "CUT lines: none") continue
    if (line.startsWith("CUT lines: ")) {
      flush()
      const range = parseRange(line.slice("CUT lines: ".length))
      if (!range) return fail(`unrecognised CUT lines ${JSON.stringify(line)}`)
      current = { from: range.from, to: range.to }
      continue
    }
    if (line.startsWith("CUT tags: ")) {
      if (!current) return fail("CUT tags without a CUT lines block")
      const span = line.slice("CUT tags: ".length).trim().split("-")
      if (span.length !== 2 || !TAG_PATTERN.test(span[0]) || !TAG_PATTERN.test(span[1]))
        return fail(`unrecognised CUT tags ${JSON.stringify(line)}`)
      current.tagFrom = span[0]
      current.tagTo = span[1]
      continue
    }
    if (line.startsWith("CUT start: ")) {
      if (!current) return fail("CUT start without a CUT lines block")
      current.startSnippet = stripQuotes(line.slice("CUT start: ".length))
      continue
    }
    if (line.startsWith("CUT end: ")) {
      if (!current) return fail("CUT end without a CUT lines block")
      current.endSnippet = stripQuotes(line.slice("CUT end: ".length))
      continue
    }
    if (line.startsWith("CUT target: ")) {
      if (!current) return fail("CUT target without a CUT lines block")
      const target = line.slice("CUT target: ".length).trim()
      if (target !== "lines" && target !== "call") return fail(`unknown CUT target ${JSON.stringify(target)}`)
      current.target = target
      continue
    }
    if (line.startsWith("REASON: ")) {
      reason = line.slice("REASON: ".length).trim()
      continue
    }
    if (line.startsWith("SIGNED: ")) {
      const value = line.slice("SIGNED: ".length).trim()
      if (value !== "keep" && value !== "cut") return fail(`unknown SIGNED verdict ${JSON.stringify(value)}`)
      signed = value
      continue
    }
    if (line.startsWith("ERRATUM after ")) {
      const match = line.match(/^ERRATUM after (\d+):\s*(.*)$/)
      if (!match) return fail(`unrecognised ERRATUM ${JSON.stringify(line)}`)
      errata.push({ after: Number(match[1]), text: match[2] })
      continue
    }
    return fail(`unrecognised line ${JSON.stringify(line)}`)
  }
  flush()
  if (!targetMd5) return fail("no EXCERPT <message-md5> address")
  if (!reason) return fail("a directive needs a reason — history without a motive is a silent edit")
  return { ok: true, directive: { targetMd5, cuts, errata, reason, signed: signed ?? "keep" } }
}

function tagLine(lines: ViewLine[], tag: string): ViewLine | undefined {
  const hits = lines.filter((l) => l.tag === tag)
  return hits.length === 1 ? hits[0] : undefined
}

function snippetLine(lines: ViewLine[], snippet: string): ViewLine | undefined {
  const hits = lines.filter((l) => l.text.includes(snippet))
  return hits.length === 1 ? hits[0] : undefined
}

/**
 * Resolve one cut against the addressed view. Tags are primary: when
 * present they must name exactly the numbered span. Snippets must match
 * uniquely and agree with the span. Bare numbers resolve inside bounds.
 * Anything else refuses — an address that guessed is worse than absent.
 */
export function resolveCut(lines: ViewLine[], cut: Cut): Ok<{ from: number; to: number }> | Refusal {
  const fail = (error: string): Refusal => ({ ok: false, error: `cut ${cut.from}-${cut.to} refused: ${error}` })
  const total = lines.length
  if (cut.from < 1 || cut.to > total || cut.to < cut.from) return fail("range is not inside the addressed view")
  if (cut.tagFrom !== undefined || cut.tagTo !== undefined) {
    if (cut.tagFrom === undefined || cut.tagTo === undefined) return fail("a half tag pair addresses nothing")
    const first = tagLine(lines, cut.tagFrom)
    const last = tagLine(lines, cut.tagTo)
    if (!first || !last) return fail("unknown address tag")
    if (first.number !== cut.from || last.number !== cut.to)
      return fail(`tags name lines ${first.number}-${last.number}, numbers say ${cut.from}-${cut.to}`)
  }
  const hasStart = cut.startSnippet !== undefined
  const hasEnd = cut.endSnippet !== undefined
  if (hasStart !== hasEnd) return fail("a half snippet pair addresses nothing")
  if (hasStart && hasEnd) {
    const first = snippetLine(lines, cut.startSnippet!)
    const last = snippetLine(lines, cut.endSnippet!)
    if (!first || !last) return fail("snippet found nowhere or more than once")
    if (first.number !== cut.from || last.number !== cut.to)
      return fail("snippets delimit a different span than the numbers")
  }
  return { ok: true, from: cut.from, to: cut.to }
}

/**
 * Whole-directive gate: nothing blanks, the call half stays, a signed
 * last turn rides verbatim (the cut takes effect at the next boundary),
 * and an erratum-only directive without cuts is legitimate.
 */
export function validateDirective(
  directive: Directive,
  view: { totalLines: number; hasSignedLastTurn: boolean },
): Ok<{}> | Refusal {
  const fail = (error: string): Refusal => ({ ok: false, error: `directive refused: ${error}` })
  if (!MD5_PATTERN.test(directive.targetMd5)) return fail("target is not a 32-hex message hash")
  if (directive.reason.trim() === "") return fail("a directive needs a reason")
  if (directive.cuts.length === 0 && directive.errata.length === 0) return fail("selects nothing")
  for (const cut of directive.cuts) {
    if (cut.target === "call") return fail("the tool call half always stays — narrow the result, never the call")
    if (cut.from < 1 || cut.to > view.totalLines || cut.to < cut.from) return fail(`cut ${cut.from}-${cut.to} is outside the view`)
    if (cut.from === 1 && cut.to === view.totalLines) return fail("a cut covering everything would blank the message")
  }
  if (view.hasSignedLastTurn && directive.cuts.length > 0)
    return fail("signed last turn rides verbatim — the cut takes effect at the next turn boundary")
  for (const erratum of directive.errata) {
    if (erratum.after < 1 || erratum.after > view.totalLines) return fail(`erratum anchor ${erratum.after} is outside the view`)
    if (erratum.text.trim() === "") return fail("an empty erratum corrects nothing")
  }
  return { ok: true }
}

export type AppliedDirective = {
  lines: ViewLine[]
  appliedCuts: { from: number; to: number }[]
  appliedErrata: number[]
  refusals: string[]
}

/**
 * Narrow the representation. Cuts overlapping a signed range are refused
 * and the range stands; an erratum appends to its anchor line, so the
 * addresses of every other line survive the edit (KV-prefix stability).
 * An anchor removed by a cut refuses its erratum — nowhere to land.
 */
export function applyDirective(
  lines: ViewLine[],
  directive: Directive,
  opts: { signedRanges: [number, number][] },
): AppliedDirective {
  const refusals: string[] = []
  const removed = new Set<number>()
  const appliedCuts: { from: number; to: number }[] = []
  const inSigned = (n: number) => opts.signedRanges.some(([from, to]) => n >= from && n <= to)
  for (const cut of directive.cuts) {
    if (cut.target === "call") {
      refusals.push(`cut ${cut.from}-${cut.to} refused: the tool call half always stays`)
      continue
    }
    let blocked = false
    for (let n = cut.from; n <= cut.to; n++) {
      if (inSigned(n)) {
        refusals.push(`cut ${cut.from}-${cut.to} refused: reaches into a signed range, the range stands`)
        blocked = true
        break
      }
    }
    if (blocked) continue
    for (let n = cut.from; n <= cut.to; n++) removed.add(n)
    appliedCuts.push({ from: cut.from, to: cut.to })
  }
  const kept = lines.filter((l) => !removed.has(l.number))
  // An attachment is one payload: a cut over it would slice a data URL
  // into the wire. Read it with a range instead — never narrow it here.
  for (const l of lines) {
    if (l.kind === "attachment" && removed.has(l.number)) {
      refusals.push(`line ${l.number} refused: an attachment is one payload, not sliceable`)
    }
  }
  const keptClean = kept.filter((l) => !(l.kind === "attachment" && removed.has(l.number)))
  const appliedErrata: number[] = []
  const out = keptClean.map((l) => ({ ...l }))
  for (const erratum of directive.errata) {
    const anchor = out.find((l) => l.number === erratum.after)
    if (!anchor) {
      refusals.push(`erratum after ${erratum.after} refused: the anchor is gone, nowhere to land`)
      continue
    }
    anchor.text = `${anchor.text}\n[erratum after ${erratum.after}]: ${erratum.text}`
    appliedErrata.push(erratum.after)
  }
  return { lines: out, appliedCuts, appliedErrata, refusals }
}
