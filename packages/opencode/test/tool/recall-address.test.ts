import { describe, expect, test } from "bun:test"
import { Database as BunDatabase } from "bun:sqlite"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { readToolResult } from "../../src/tool/recall"
import { selectLines } from "../../src/session/message-v2"
import { RESULT_LIMIT_CHARS, RESULT_LIMIT_LINES } from "@/tool/result-limit"

/**
 * ONE ADDRESS SPACE for `read` and `recall` (plan 2026-10-13_recall-read-address-space, owner ruling:
 * «У роботов при recall чета не так сворачивается и они неправильно читают файлы»).
 *
 * The defect these cases pin is an OFF-BY-SCAFFOLD: `recall` sliced the STORED TEXT of the part, so
 * row 1 of a recalled `read` was the `[system evidence_ref=…]` header and file line 1130 sat on
 * recall row 5 (measured on `.opencode/data/opencode.db`, 2026-10-13). A robot that recalled what it
 * had read could not name a line of the file, and a line too long for one answer was cut and reported
 * as `(complete)` — the caller was told the result had ended while the rest of the line was still
 * stored. Both are address errors, so both are asserted here against real stored bytes.
 *
 * Fixture note: every stored form is REPRODUCED from the producer, not invented — the scaffold and
 * the wrap marker are read.ts:402/415/628, the header is processor.ts:721, the numbered row is
 * read.ts:403 and the hash width is read.ts:495. A fixture that only looked like the real stored text
 * could not see the shift (the same lesson as the hand-built `part` fixture that hid `keep`).
 */
const dir = mkdtempSync(path.join(tmpdir(), "recall-address-"))
const dbPath = path.join(dir, "opencode.db")

const db = new BunDatabase(dbPath, { create: true })
db.exec(
  "CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL)",
)
const insert = db.prepare("INSERT INTO part (id, message_id, session_id, type, data) VALUES (?, ?, ?, ?, ?)")

function seed(id: string, type: string, data: unknown) {
  insert.run(id, "message", "session", type, JSON.stringify(data))
}

function seedTool(id: string, output: string, tool: string, title?: string, input?: unknown) {
  seed(id, "tool", {
    type: "tool",
    tool,
    callID: "call",
    state: { status: "completed", output, ...(title === undefined ? {} : { title }), ...(input === undefined ? {} : { input }) },
  })
}

function call(input: { id: string; range?: string; pattern?: string; ignoreCase?: boolean; maxChars?: number; chars?: string; keep?: boolean; release?: boolean; reason?: string }) {
  return readToolResult({ dbPath, maxChars: RESULT_LIMIT_CHARS, reason: "test", ...input })
}

/** The evidence header processor.ts:721 prepends to every stored tool result. */
function evidenceHeader(tool: string) {
  return `[system evidence_ref=ev_0a1b2c3d4e5f60718293a4b5 tool=${tool} execution=OK oracle=eligible]`
}

/** The hash `read` prints beside a line (read.ts:494 — 8 lowercase hex characters). */
function hash(i: number) {
  return (0x1a2b3c4d + i * 0x101).toString(16).slice(-8).padStart(8, "0")
}

const WRAP = 2_000

/** The exact wrapping `read.ts:626-648` applies to a line longer than 2 000 chars, marker included. */
function wrapLine(text: string): string {
  const chunks: string[] = []
  for (let cursor = 0; cursor < text.length; cursor += WRAP) {
    const piece = text.slice(cursor, cursor + WRAP)
    chunks.push(cursor === 0 ? piece : `      ↳+${cursor}: ${piece}`)
  }
  return chunks.join("\n")
}

/**
 * A stored `read` result as the product writes it: header, `<path>/<type>/<content>` scaffold,
 * `<file line>  <hash>: <text>` rows, read's own footer notice, closing tag.
 */
function storedRead(input: { path: string; offset: number; lines: string[]; total: number }) {
  const body = input.lines.map((line, i) => `${input.offset + i}  ${hash(i)}: ${line}`).join("\n")
  const last = input.offset + input.lines.length - 1
  const footer =
    last >= input.total
      ? `(End of file - total ${input.total} lines)`
      : `(Showing lines ${input.offset}-${last} of ${input.total}. Use offset=${last + 1} to continue.)`
  return [
    evidenceHeader("read"),
    `<path>${input.path}</path>`,
    "<type>file</type>",
    "<content>",
    body,
    "",
    footer,
    "</content>",
  ].join("\n")
}

/** The content characters of an answer, address and wrap marker removed. */
function bodyOf(text: string) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((row) => row.replace(/^\d+  [0-9a-f]{8}: /, "").replace(/^↳\+\d+: /, ""))
    .join("")
}

const window13 = {
  path: "docs/compaction.md",
  offset: 1_130,
  lines: Array.from({ length: 13 }, (_, i) => `file line ${1_130 + i}`),
  total: 2_000,
}

describe("recall: a stored `read` answers in the FILE's line numbers", () => {
  test("a range is a range of FILE lines, and every row carries exactly one number", () => {
    seedTool("prt_read", storedRead(window13), "read", window13.path)

    const window = call({ id: "prt_read", range: "1131-1133" })
    expect(window.ok).toBe(true)
    if (!window.ok) throw new Error(window.error)
    expect(window.matchedLines).toBe(3)
    expect(window.firstLine).toBe(1_131)
    expect(window.lastLine).toBe(1_133)
    // The row IS the line read printed: one number, the file's, and the hash stays addressable for
    // `edit`. The stored text under this line is what a row must reproduce, nothing else.
    const stored = storedRead(window13).split("\n")
    expect(window.text).toBe(`${stored[5]}\n${stored[6]}\n${stored[7]}\n`)
    // ONE number per row, and it is the FILE's. The reading this replaces numbered the stored line as
    // well, so a row began `1: 1130  hash: …` — two addresses, one of which addressed nothing outside
    // `recall` itself, which is how a recalled line stopped being a line of the file.
    expect(window.text.split("\n")[0]).toBe(stored[5])
    expect(window.text.split("\n")[0]).not.toMatch(/^\d+: \d/)
  })

  test("the header and the scaffold are NOT addressable — `range=1` on a window at 1130 matches nothing", () => {
    seedTool("prt_read_head", storedRead(window13), "read", window13.path)

    const before = call({ id: "prt_read_head", range: "1-3" })
    expect(before.ok).toBe(true)
    if (!before.ok) throw new Error(before.error)
    expect(before.matchedLines).toBe(0)
    expect(before.text).toBe("")

    // …and the first line of the WINDOW is still reachable, at its own number.
    const first = call({ id: "prt_read_head", range: "1130" })
    if (!first.ok) throw new Error(first.error)
    expect(first.text.endsWith("file line 1130\n")).toBe(true)
    expect(first.text).not.toContain("evidence_ref")
    expect(first.firstLine).toBe(1_130)
  })

  test("a body with no numbers of its own starts at 1, with the header outside it", () => {
    seedTool("prt_web", `${evidenceHeader("webfetch")}\nfirst body line\nsecond body line`, "webfetch", "https://x")

    const result = call({ id: "prt_web", range: "1" })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.totalLines).toBe(2)
    expect(result.text).toBe("1: first body line\n")
  })
})

describe("recall: a line too long for one answer is read in pieces", () => {
  const long = "L" + "x".repeat(16_999)
  const longRead = { path: "data/huge.json", offset: 7, lines: [wrapLine(long)], total: 7 }

  test("the walk reconstructs the whole line, each answer inside the cap, none claiming to be complete early", () => {
    seedTool("prt_long", storedRead(longRead), "read", longRead.path)

    const seen: string[] = []
    let chars: string | undefined
    let answers = 0
    for (let guard = 0; guard < 20; guard++) {
      const answer = call({ id: "prt_long", range: "7", chars, maxChars: 4_000 })
      expect(answer.ok).toBe(true)
      if (!answer.ok) throw new Error(answer.error)
      answers += 1
      // Each answer respects the cap the caller set — that is the whole point of asking in pieces.
      expect(answer.text.length).toBeLessThanOrEqual(4_000)
      seen.push(bodyOf(answer.text))
      if (answer.nextChars === null) break
      // The answer NAMES where the line continues: the same character offsets `read` prints after
      // `↳+`, so the next request is written from what is already on screen.
      expect(answer.nextChars.line).toBe(7)
      expect(answer.nextChars.of).toBe(long.length)
      expect(answer.nextChars.from).toBeGreaterThan(1)
      chars = `${answer.nextChars.from}-`
    }

    expect(seen.join("")).toBe(long)
    expect(answers).toBeGreaterThanOrEqual(3)
  })

  test("a cut line names the character to continue from instead of reporting the result complete", () => {
    seedTool("prt_long_cut", storedRead(longRead), "read", longRead.path)

    const first = call({ id: "prt_long_cut", range: "7", maxChars: 4_000 })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.error)
    expect(first.matchedLines).toBe(1)
    expect(first.nextLine).toBeNull()
    // The cut is NAMED, not hidden: the row carries the first N characters, and the continuation is a
    // character window inside the same line — never the old «(complete)» over a truncated row.
    expect(first.nextChars).not.toBeNull()
    if (first.nextChars === null) throw new Error("expected a cut to continue from")
    expect(first.nextChars.line).toBe(7)
    expect(first.nextChars.of).toBe(long.length)
    expect(first.text.length).toBeLessThanOrEqual(4_000)

    const rest = call({ id: "prt_long_cut", range: "7", chars: `${first.nextChars.from}-`, maxChars: 4_000 })
    if (!rest.ok) throw new Error(rest.error)
    // The SAME address `read` prints after a wrapped chunk — arrow, plus, character offset — built from
    // the code point rather than typed, so the test states the character it depends on.
    expect(rest.text).toContain(`${String.fromCharCode(0x21b3)}+${first.nextChars.from}: `)
  })

  test("a character window outside the line, or over more than one line, is refused with its reason", () => {
    seedTool("prt_chars", storedRead(window13), "read", window13.path)

    const tooMany = call({ id: "prt_chars", range: "1130-1131", chars: "1-5" })
    expect(tooMany.ok).toBe(false)
    if (tooMany.ok) throw new Error("expected refusal")
    expect(tooMany.error).toContain("ONE line")

    const past = call({ id: "prt_chars", range: "1130", chars: "9000-" })
    expect(past.ok).toBe(false)
    if (past.ok) throw new Error("expected refusal")
    expect(past.error).toContain("13")
  })
})

describe("recall: a recall result is not recallable", () => {
  test("refuses it and names the SOURCE part the earlier recall read", () => {
    seedTool("prt_source_grep", "grep id=prt_source_grep — result delivered earlier (10.0 KB)\n1: hit", "grep")
    seed("prt_recall_of_recall", "tool", {
      type: "tool",
      tool: "recall",
      callID: "call",
      state: {
        status: "completed",
        input: { id: "prt_source_grep", range: "0" },
        output: `${evidenceHeader("recall")}\nrecall: grep: log\\.(debug|info) — id=prt_source_grep\nrange "0" of 1 line(s), 40 chars\n\n1: hit`,
      },
    })

    const result = call({ id: "prt_recall_of_recall" })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected refusal")
    expect(result.error).toContain("prt_source_grep")
    expect(result.error.toLowerCase()).toContain("recall")
  })
})

describe("recall: a result can be RELEASED entirely (T4c)", () => {
  const unit = {
    path: "Unit1.pas",
    offset: 1,
    lines: Array.from({ length: 400 }, (_, i) => `line ${i + 1} ${"z".repeat(120)}`),
    total: 400,
  }
  const WHY = "the edit that needed the unit is done"

  test("the release reaches the part ROW, and recall(id) still returns every line afterwards", () => {
    seedTool("prt_release", storedRead(unit), "read", unit.path)

    const released = call({ id: "prt_release", release: true, reason: WHY })
    expect(released.ok).toBe(true)
    if (!released.ok) throw new Error(released.error)
    expect(released.released).toEqual({ reason: WHY })

    // WHERE IT LANDS, first half: the row. The tool persists exactly this state through the same
    // `updatePart` a kept selection uses, so the test writes what the tool hands back and reads the
    // row AGAIN — the check a typecheck cannot make, and the one that once caught nothing while a
    // cast in a write path persisted a `keep` that never landed.
    const stored = released.part
    db.prepare("UPDATE part SET data = ? WHERE id = ?").run(
      JSON.stringify({ ...JSON.parse(JSON.stringify(stored)), state: { ...stored.state, released: released.released } }),
      stored.id,
    )
    const row = db.prepare("SELECT data FROM part WHERE id = ?").get(stored.id) as { data: string }
    expect(JSON.parse(row.data).state.released).toEqual({ reason: WHY })

    // …and the release REPLACED nothing: every line is still stored, and the call the placeholder will
    // name returns them. A release that could not be taken back would be a loss, not a saving.
    const again = call({ id: "prt_release", range: "0" })
    if (!again.ok) throw new Error(again.error)
    expect(again.totalLines).toBe(400)
    expect(again.matchedLines).toBe(400)
    // …and the LAST line is still reachable by its own number: nothing was renumbered or dropped.
    const tail = call({ id: "prt_release", range: "400" })
    if (!tail.ok) throw new Error(tail.error)
    expect(tail.text).toContain("line 400")
  })

  test("a release with no reason is refused, and a recall result is not releasable at all", () => {
    seedTool("prt_release_bare", storedRead(unit), "read", unit.path)
    const bare = call({ id: "prt_release_bare", release: true, reason: "   " })
    expect(bare.ok).toBe(false)
    if (bare.ok) throw new Error("expected refusal")
    expect(bare.error).toContain("reason")

    // Releasing a recall result would put it out of the window AND out of reach: T3 refuses to recall
    // a recall, so the stored text could never come back. The refusal names the part that CAN be read.
    seed("prt_release_recall", "tool", {
      type: "tool",
      tool: "recall",
      callID: "call",
      state: { status: "completed", input: { id: "prt_source_grep" }, output: "recall: grep — id=prt_source_grep\n\n1: hit" },
    })
    const wrapper = call({ id: "prt_release_recall", release: true, reason: WHY })
    expect(wrapper.ok).toBe(false)
    if (wrapper.ok) throw new Error("expected refusal")
    expect(wrapper.error).toContain("prt_source_grep")
  })
})

describe("recall: the per-call cap is the owner's PAIR, not a private 32 000", () => {
  test("asking for more than the pair is clamped to it, and the answer names the continuation", () => {
    const rows = Array.from({ length: 300 }, (_, i) => `row ${i + 1} ${"z".repeat(1_000)}`)
    seedTool("prt_cap", rows.join("\n"), "grep")

    const capped = call({ id: "prt_cap", range: "0", maxChars: RESULT_LIMIT_CHARS * 4 })
    if (!capped.ok) throw new Error(capped.error)
    expect(capped.text.length).toBeLessThanOrEqual(RESULT_LIMIT_CHARS)
    const resume = capped.nextLine
    expect(resume).not.toBeNull()
    if (resume === null) throw new Error("expected a line to continue from")

    const next = call({ id: "prt_cap", range: `${resume}-` })
    if (!next.ok) throw new Error(next.error)
    expect(next.firstLine).toBe(resume)
  })

  test("the LINE bound caps one answer at 16 384 rows even when the characters would fit", () => {
    const many = Array.from({ length: RESULT_LIMIT_LINES + 10 }, (_, i) => `r${i + 1}`)
    seedTool("prt_linecap", many.join("\n"), "grep")

    const answer = call({ id: "prt_linecap", range: "0" })
    if (!answer.ok) throw new Error(answer.error)
    expect(answer.text.split("\n").filter(Boolean).length).toBe(RESULT_LIMIT_LINES)
    expect(answer.nextLine).toBe(RESULT_LIMIT_LINES + 1)
  })
})

describe("recall: `chars` addresses a position inside ONE line", () => {
  const long = "L" + "x".repeat(16_999)
  const longRead = { path: "data/huge.json", offset: 7, lines: [wrapLine(long)], total: 7 }

  test("a window can be asked for ANYWHERE inside the line, not only by walking to it", () => {
    // This is what `chars` buys over the cut-and-continue path: the caller who knows WHICH part of a
    // 17 000-char line it needs — the middle of a minified file, say — asks for it directly, and the
    // answer contains exactly that window and nothing else.
    seedTool("prt_chars_jump", storedRead(longRead), "read", longRead.path)

    const slice = call({ id: "prt_chars_jump", range: "7", chars: "8000-9000" })
    expect(slice.ok).toBe(true)
    if (!slice.ok) throw new Error(slice.error)
    expect(bodyOf(slice.text)).toBe(long.slice(7_999, 9_000))
    expect(slice.text).toContain(`${String.fromCharCode(0x21b3)}+8000: `)
    expect(slice.nextChars).toMatchObject({ line: 7, from: 9_001, of: long.length })

    // …and the head of the line is a window too: no marker, because there is nothing before it.
    const head = call({ id: "prt_chars_jump", range: "7", chars: "-10" })
    if (!head.ok) throw new Error(head.error)
    expect(bodyOf(head.text)).toBe(long.slice(0, 10))
    expect(head.text).not.toContain(String.fromCharCode(0x21b3))
  })
})

/**
 * THE ROWS `read` PRINTED BEFORE 2026-10-01 (plan 2026-10-13_recall-read-address-space, R1).
 *
 * The hash in a row (`<n>  <hash>: <text>`) is what `edit` addresses by, and it shipped 2026-10-01 —
 * so every read stored before it prints `<n>: <text>` with no hash at all. In this worktree's session
 * database that is 2 360 of 5 694 stored reads (measured 2026-10-13), and the parser knew only the
 * hashed dialect: it numbered such a body by ROW INDEX over the whole stored text, so `recall` of one
 * answered `300: 300:    clean fold prints `GAP`…` — the recall's own index in front of the number
 * the row already carried, over a body whose header had shifted every row by four (reproduced on
 * `prt_0e034e462001zX1Tqo2F6TJ0Mc`, `docs/compaction.md`, 867 stored lines).
 *
 * The bytes below are that part's shape verbatim: the same scaffold, the same inner footer notice,
 * rows as `<file line>: <text>`.
 */
function legacyStoredRead(input: { path: string; offset: number; lines: string[]; total: number }) {
  const body = input.lines.map((line, i) => `${input.offset + i}: ${line}`).join("\n")
  const last = input.offset + input.lines.length - 1
  const footer =
    last >= input.total
      ? `(End of file - total ${input.total} lines)`
      : `(Showing lines ${input.offset}-${last} of ${input.total}. Use offset=${last + 1} to continue.)`
  return [evidenceHeader("read"), `<path>${input.path}</path>`, "<type>file</type>", "<content>", body, "", footer, "</content>"].join("\n")
}

const legacyWindow = {
  path: "docs/compaction.md",
  offset: 296,
  lines: [
    "   the boundary is the newest message a summary actually covers.",
    "3. **Nothing hidden without representation.** — the accounting names the",
    "   machinery it omits (a prior m* row, a Layer-1 panel, a summary anchor).",
    "   Otherwise a",
    "   clean fold prints `GAP`, and a check that cries wolf is a check nobody reads —",
    "   measured 2026-09-19, on the first fold under this rule.",
    "   for `#2999` (`msg_0b9bdc0b70011O6AWB9yu16rVD`), which is a Layer-1 panel.",
  ],
  total: 867,
}
const legacyRow300 = "300:    clean fold prints `GAP`, and a check that cries wolf is a check nobody reads —"
const legacyRow301 = "301:    measured 2026-09-19, on the first fold under this rule."

describe("recall: a read stored in the LEGACY row format is addressed by its own numbers", () => {
  test("a range answers FILE lines with ONE number each, never a doubled index over a shifted body", () => {
    seedTool("prt_legacy", legacyStoredRead(legacyWindow), "read", legacyWindow.path)

    const window = call({ id: "prt_legacy", range: "300-301" })
    expect(window.ok).toBe(true)
    if (!window.ok) throw new Error(window.error)
    expect(window.matchedLines).toBe(2)
    expect(window.firstLine).toBe(300)
    expect(window.lastLine).toBe(301)
    for (const row of window.text.split("\n").filter(Boolean)) expect(row).toMatch(/^\d+: /)
    // The defect: the recall's own row index in front of the number the stored row already carried.
    expect(window.text.split("\n")[0]).not.toMatch(/^\d+: \d/)
    expect(window.text.split("\n")[0]).toBe(legacyRow300)
    // …and the footer notice inside the scaffold is not a line of the file.
    expect(window.totalLines).toBe(legacyWindow.lines.length)
  })

  test("the window's own numbers are the address: below it nothing is selected, and `keep` records THESE", () => {
    seedTool("prt_legacy_keep", legacyStoredRead(legacyWindow), "read", legacyWindow.path)

    const before = call({ id: "prt_legacy_keep", range: "1-3" })
    if (!before.ok) throw new Error(before.error)
    expect(before.matchedLines).toBe(0)

    // `kept` is what the REPLAY renders through `selectLines` — the OTHER consumer of the address
    // space — so it must name the lines the recall just showed, and render them the same way: two
    // readings of one body would put one thing on screen and another on the wire.
    const kept = call({ id: "prt_legacy_keep", range: "300-301", keep: true })
    if (!kept.ok) throw new Error(kept.error)
    expect(kept.kept).toEqual({ from: 300, to: 301, reason: "test" })
    expect(selectLines(legacyStoredRead(legacyWindow), { from: 300, to: 301 }).rows).toEqual([legacyRow300, legacyRow301])
  })
})
