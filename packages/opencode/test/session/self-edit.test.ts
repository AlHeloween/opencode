import { describe, expect, test } from "bun:test"
import {
  applyDirective,
  isSelfEditEnabled,
  messageMd5,
  parseDirective,
  resolveCut,
  validateDirective,
  type ViewLine,
} from "@/session/self-edit"

/**
 * The self-edit directive contract (t70 P1a), pinned before the product.
 *
 * An agent repairs its OWN replayed representation (Continuity rule 4):
 * CUT removes lines from what replays, ERRATUM adds a correction after
 * line N. The stored original never changes — this module only narrows the
 * representation handed to it. Signed thinking of the last turn inside an
 * active tool-use loop rides verbatim (E5 wire evidence); a cut reaching
 * into it is refused, not silently applied. Line numbers are advisory:
 * tags and unique snippets resolve, numbers alone never overrule them.
 */

function lines(n: number, kind: ViewLine["kind"] = "text"): ViewLine[] {
  return Array.from({ length: n }, (_, i) => ({
    number: i + 1,
    tag: (i + 1).toString(16).padStart(8, "0"),
    text: `line ${i + 1} content here`,
    kind,
  }))
}

const MD5 = "9e8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c"

function directiveText(overrides: Partial<Record<string, string>> = {}): string {
  const base: Record<string, string> = {
    target: `EXCERPT ${MD5}`,
    cutLines: "CUT lines: 2-4",
    cutTags: "CUT tags: 00000002-00000004",
    cutStart: 'CUT start: "line 2 content here"',
    cutEnd: 'CUT end: "line 4 content here"',
    reason: "REASON: status chatter, superseded",
    signed: "SIGNED: cut",
    erratum: "ERRATUM after 5: timestamps run backwards, order is inconsistent",
  };
  return Object.values({ ...base, ...overrides }).join("\n") + "\n"
}

describe("parseDirective", () => {
  test("a well-formed single-cut directive parses with every field", () => {
    const parsed = parseDirective(directiveText())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.directive.targetMd5).toBe(MD5)
    expect(parsed.directive.cuts).toHaveLength(1)
    expect(parsed.directive.cuts[0].from).toBe(2)
    expect(parsed.directive.cuts[0].to).toBe(4)
    expect(parsed.directive.reason).toContain("status chatter")
    expect(parsed.directive.errata).toHaveLength(1)
    expect(parsed.directive.errata[0].after).toBe(5)
  })

  test("garbage is refused, never parsed into an empty directive", () => {
    const parsed = parseDirective("hello\nworld\n")
    expect(parsed.ok).toBe(false)
  })

  test("a missing reason refuses the whole directive", () => {
    const parsed = parseDirective(directiveText({ reason: "REASON: " }))
    expect(parsed.ok).toBe(false)
  })

  test("a non-md5 target refuses the whole directive", () => {
    const parsed = parseDirective(directiveText({ target: "EXCERPT not-a-hash" }))
    expect(parsed.ok).toBe(false)
  })

  test("two CUT blocks parse as two cuts", () => {
    const second = ["CUT lines: 7-8", "CUT tags: 00000007-00000008"].join("\n") + "\n"
    const parsed = parseDirective(directiveText() + second)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.directive.cuts).toHaveLength(2)
  })
})

describe("resolveCut — tags and snippets resolve, numbers advise", () => {
  test("tags agreeing with numbers resolve the span", () => {
    const resolved = resolveCut(lines(10), { from: 2, to: 4, tagFrom: "00000002", tagTo: "00000004" })
    expect(resolved).toEqual({ ok: true, from: 2, to: 4 })
  })

  test("tags disagreeing with numbers refuse instead of silently reslicing", () => {
    // The model miscounted: numbers say 2-4, tags say lines 3-5. Guessing
    // which one it meant would be worse than refusing (Phase E: 48% agreement).
    const resolved = resolveCut(lines(10), { from: 2, to: 4, tagFrom: "00000003", tagTo: "00000005" })
    expect(resolved.ok).toBe(false)
  })

  test("bare numbers inside bounds resolve (advisory, weakest leg)", () => {
    const resolved = resolveCut(lines(10), { from: 2, to: 4 })
    expect(resolved).toEqual({ ok: true, from: 2, to: 4 })
  })

  test("out-of-bounds numbers refuse", () => {
    expect(resolveCut(lines(10), { from: 9, to: 12 }).ok).toBe(false)
    expect(resolveCut(lines(10), { from: 5, to: 3 }).ok).toBe(false)
  })

  test("a unique snippet pair resolves to the same span as the numbers", () => {
    const resolved = resolveCut(lines(10), {
      from: 2,
      to: 4,
      startSnippet: "line 2 content here",
      endSnippet: "line 4 content here",
    })
    expect(resolved).toEqual({ ok: true, from: 2, to: 4 })
  })

  test("an ambiguous snippet refuses — unique match or nothing", () => {
    const rows = lines(10).map((l) => ({ ...l, text: "same text everywhere" }))
    const resolved = resolveCut(rows, { from: 2, to: 4, startSnippet: "same text", endSnippet: "same text" })
    expect(resolved.ok).toBe(false)
  })

  test("a snippet found nowhere refuses", () => {
    const resolved = resolveCut(lines(10), { from: 2, to: 4, startSnippet: "no such line", endSnippet: "no such line" })
    expect(resolved.ok).toBe(false)
  })
})

describe("validateDirective — nothing blanks, nothing silent", () => {
  const view = { totalLines: 10, hasSignedLastTurn: false, hasCallLines: true }

  test("a cut covering everything refuses (never blank)", () => {
    const parsed = parseDirective(directiveText({ cutLines: "CUT lines: 1-10", cutTags: "CUT tags: 00000001-0000000a" }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(validateDirective(parsed.directive, view).ok).toBe(false)
  })

  test("a cut aimed at the tool call refuses — the call half always stays", () => {
    const parsed = parseDirective(directiveText())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const aimed = { ...parsed.directive, cuts: [{ ...parsed.directive.cuts[0], target: "call" as const }] }
    expect(validateDirective(aimed, view).ok).toBe(false)
  })

  test("a cut into the signed block of the last turn refuses (verbatim replay)", () => {
    const parsed = parseDirective(directiveText())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(validateDirective(parsed.directive, { ...view, hasSignedLastTurn: true }).ok).toBe(false)
  })

  test("the same cut without a signed last turn is allowed", () => {
    const parsed = parseDirective(directiveText())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(validateDirective(parsed.directive, view).ok).toBe(true)
  })
})

describe("applyDirective — representation narrows, sources stand", () => {
  test("cut lines leave the replay, erratum lands after its anchor", () => {
    const parsed = parseDirective(directiveText())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const applied = applyDirective(lines(10), parsed.directive, { signedRanges: [] })
    expect(applied.refusals).toEqual([])
    const numbers = applied.lines.map((l: ViewLine) => l.number)
    expect(numbers).toEqual([1, 5, 6, 7, 8, 9, 10])
    expect(applied.lines[1].text).toContain("timestamps run backwards")
  })

  test("a cut overlapping a signed range is refused and the range stands", () => {
    const parsed = parseDirective(directiveText())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const applied = applyDirective(lines(10), parsed.directive, { signedRanges: [[3, 4]] })
    expect(applied.refusals).toHaveLength(1)
    const numbers = applied.lines.map((l: ViewLine) => l.number)
    expect(numbers).toContain(3)
    expect(numbers).toContain(4)
  })

  test("a refusal carries text — the model is shown why, never silence", () => {
    const parsed = parseDirective("garbage\n")
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error.length).toBeGreaterThan(0)
  })
})

describe("messageMd5 and the switch", () => {
  test("md5 is a stable 32-hex content hash, not a label", () => {
    expect(messageMd5("hello")).toBe(messageMd5("hello"))
    expect(messageMd5("hello")).toMatch(/^[0-9a-f]{32}$/)
    expect(messageMd5("hello")).not.toBe(messageMd5("world"))
  })

  test("the switch defaults OFF and reads one env name", () => {
    expect(isSelfEditEnabled({})).toBe(false)
    expect(isSelfEditEnabled({ OPENCODE_SELF_EDIT_DIRECTIVE: "1" })).toBe(true)
    expect(isSelfEditEnabled({ OPENCODE_SELF_EDIT_DIRECTIVE: "0" })).toBe(false)
  })
})
