import { describe, expect, test } from "bun:test"
import { Database as BunDatabase } from "bun:sqlite"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { parseRange, readToolResult } from "../../src/tool/recall"

/**
 * `recall` is the way back from the wire placeholder `[tool id=<partID> — result delivered
 * earlier (N KB)]` that replaces every completed tool result heavier than 8 000 chars once its
 * turn is no longer the one being continued (`message-v2.ts:1124`).
 *
 * One fixture database for the whole file with a unique id per case, and NO `rmSync` teardown:
 * on Windows an SQLite file stays mapped after `close()`, so removing the temp directory raises
 * `EBUSY` and turns passing assertions into a failing test (measured here — 14/14 assertions
 * passed, 6/6 cases failed, all on `rm`).
 */
const dir = mkdtempSync(path.join(tmpdir(), "recall-"))
const dbPath = path.join(dir, "opencode.db")

const db = new BunDatabase(dbPath, { create: true })
// The REAL column set: the identity lives in COLUMNS and the JSON blob holds only the part's own
// fields. A fixture with `id/data` alone cannot see a lookup that reads the wrong thing — which is
// exactly how a `keep` that could never write anything shipped green.
db.exec(
  "CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL)",
)
const insert = db.prepare("INSERT INTO part (id, message_id, session_id, type, data) VALUES (?, ?, ?, ?, ?)")

function seed(id: string, type: string, data: unknown) {
  insert.run(id, "message", "session", type, JSON.stringify(data))
}

function seedTool(id: string, status: string, output: string, tool = "grep", title?: string) {
  seed(id, "tool", { type: "tool", tool, callID: "call", state: { status, output, ...(title === undefined ? {} : { title }) } })
}

function call(input: { id: string; range?: string; pattern?: string; ignoreCase?: boolean; maxChars?: number; keep?: boolean }) {
  return readToolResult({ dbPath, maxChars: 32_000, reason: "test", ...input })
}

/** Five known lines, so a range answer can be read off by eye. */
const five = ["alpha one", "beta two", "gamma three", "delta four", "epsilon five"].join("\n")

describe("recall: range parsing", () => {
  test("0, empty and 'all' mean the whole result", () => {
    for (const range of ["0", "", "all", undefined]) {
      expect(parseRange(range, 9)).toEqual({ ok: true, from: 1, to: 9 })
    }
  })

  test("explicit spans, open ends and single lines", () => {
    expect(parseRange("2-4", 9)).toEqual({ ok: true, from: 2, to: 4 })
    expect(parseRange("3-", 9)).toEqual({ ok: true, from: 3, to: 9 })
    expect(parseRange("-3", 9)).toEqual({ ok: true, from: 1, to: 3 })
    expect(parseRange("7", 9)).toEqual({ ok: true, from: 7, to: 7 })
  })

  test("a malformed range is refused, not silently clamped", () => {
    expect(parseRange("4-2", 9).ok).toBe(false)
    expect(parseRange("0-3", 9).ok).toBe(false)
    expect(parseRange("last", 9).ok).toBe(false)
  })
})

describe("recall: reading a stored tool result by part id", () => {
  test("returns the whole result with absolute line numbers", () => {
    seedTool("prt_five", "completed", five)
    const result = call({ id: "prt_five" })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.totalLines).toBe(5)
    expect(result.matchedLines).toBe(5)
    expect(result.firstLine).toBe(1)
    expect(result.lastLine).toBe(5)
    expect(result.text).toBe("1: alpha one\n2: beta two\n3: gamma three\n4: delta four\n5: epsilon five\n")
    expect(result.nextLine).toBeNull()
  })

  test("a range returns that window, numbered absolutely", () => {
    seedTool("prt_range", "completed", five)
    const result = call({ id: "prt_range", range: "2-4" })
    if (!result.ok) throw new Error(result.error)
    expect(result.text).toBe("2: beta two\n3: gamma three\n4: delta four\n")
    expect(result.firstLine).toBe(2)
    expect(result.lastLine).toBe(4)
  })

  test("a pattern filters inside the range and keeps the numbers", () => {
    seedTool("prt_pat", "completed", five)
    const result = call({ id: "prt_pat", pattern: "^\\w+ three$|^delta" })
    if (!result.ok) throw new Error(result.error)
    expect(result.matchedLines).toBe(2)
    expect(result.text).toBe("3: gamma three\n4: delta four\n")
  })

  test("range and pattern combine: the range is the window, the pattern filters it", () => {
    seedTool("prt_both", "completed", five)
    const result = call({ id: "prt_both", range: "2-3", pattern: "^gamma" })
    if (!result.ok) throw new Error(result.error)
    expect(result.matchedLines).toBe(1)
    expect(result.text).toBe("3: gamma three\n")
  })

  test("keep hands back the selection to persist, and only when asked for", () => {
    // `keep` is what turns recall from a cost into an optimisation: the caller states the slice it
    // wants to LEAVE on the result, and the tool persists exactly that. Nothing may be written when
    // the caller did not ask, or a plain read would silently shrink the stored result.
    seedTool("prt_keep", "completed", five)

    const plain = call({ id: "prt_keep", range: "2-4" })
    if (!plain.ok) throw new Error(plain.error)
    expect(plain.kept).toBeUndefined()

    const kept = call({ id: "prt_keep", range: "2-4", pattern: "gamma", keep: true })
    if (!kept.ok) throw new Error(kept.error)
    expect(kept.kept).toEqual({ from: 2, to: 4, pattern: "gamma", reason: "test" })

    // The whole result stays addressable afterwards: keep narrows what replays, it does not delete.
    const wider = call({ id: "prt_keep", range: "0" })
    if (!wider.ok) throw new Error(wider.error)
    expect(wider.matchedLines).toBe(5)
  })

  test("a recalled part carries the identity from the COLUMNS, so it can be written back", () => {
    // The identity is NOT in the JSON blob: a lookup that read only `data` returned a part that looked
    // complete and could not be written — `session.updatePart` rejected it with "sessionID required
    // but not found", so `keep` never persisted anything until a live run caught it. This is the
    // assertion the fixture could not make while it had no `session_id`/`message_id` columns.
    seedTool("prt_identity", "completed", five)
    const result = call({ id: "prt_identity", keep: true })
    if (!result.ok) throw new Error(result.error)
    expect(result.part.id).toBe("prt_identity")
    expect(result.part.sessionID).toBe("session")
    expect(result.part.messageID).toBe("message")
    expect(result.part.type).toBe("tool")
    expect(result.part.callID).toBe("call")
  })

  test("carries the same label the placeholder printed, so two recalls cannot be confused", () => {
    // The placeholder on the wire reads `[grep id=prt_x — result delivered earlier (10.0 KB, <title>)]`.
    // If the answer did not repeat that title, the only thing distinguishing two recalled results
    // would be an opaque id.
    seedTool("prt_labelled", "completed", five, "grep", "log\\.(debug|info)")
    const labelled = call({ id: "prt_labelled" })
    if (!labelled.ok) throw new Error(labelled.error)
    expect(labelled.title).toBe("log\\.(debug|info)")
    expect(labelled.label).toBe("grep: log\\.(debug|info)")

    seedTool("prt_bare", "completed", five, "bash")
    const bare = call({ id: "prt_bare" })
    if (!bare.ok) throw new Error(bare.error)
    expect(bare.title).toBe("")
    expect(bare.label).toBe("bash")
  })

  test("an invalid pattern is refused with its own reason", () => {
    seedTool("prt_bad", "completed", five)
    const result = call({ id: "prt_bad", pattern: "([unclosed" })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected refusal")
    expect(result.error.toLowerCase()).toContain("regular expression")
  })

  test("a result larger than the cap is walked by line without loss or duplication", () => {
    // The invariant that matters: reconstruct the original byte for byte, because the cap is the
    // same ceiling the replay path applies.
    const lines = Array.from({ length: 400 }, (_, i) => `line ${i + 1} ${"y".repeat(90)}`)
    const output = lines.join("\n")
    seedTool("prt_walk", "completed", output)

    const seen: string[] = []
    let range: string | undefined = "0"
    for (let guard = 0; guard < 100; guard++) {
      const result = call({ id: "prt_walk", range })
      if (!result.ok) throw new Error(result.error)
      seen.push(...result.text.split("\n").filter(Boolean).map((row) => row.replace(/^\d+: /, "")))
      if (result.nextLine === null) break
      range = `${result.nextLine}-`
    }

    expect(seen).toEqual(lines)
  })

  test("a window past the end matches nothing rather than throwing", () => {
    seedTool("prt_short", "completed", "abc")
    const result = call({ id: "prt_short", range: "99-120" })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.matchedLines).toBe(0)
    expect(result.text).toBe("")
    expect(result.nextLine).toBeNull()
  })

  test("refuses a part that is not a tool result", () => {
    seed("prt_text", "text", { type: "text", text: "hello" })
    const result = call({ id: "prt_text" })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected refusal")
    expect(result.error).toContain("not a tool result")
  })

  test("refuses an unknown id", () => {
    expect(call({ id: "prt_missing" }).ok).toBe(false)
  })

  test("an errored result is recallable — an error is what must stay filterable", () => {
    seed("prt_err", "tool", { type: "tool", tool: "bash", state: { status: "error", error: "boom: exit 2\nsecond line" } })
    const result = call({ id: "prt_err" })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.matchedLines).toBe(2)
    expect(result.text).toContain("1: boom: exit 2")
  })

  test("refuses a result that never finished", () => {
    seedTool("prt_run", "running", "partial", "bash")
    const result = call({ id: "prt_run" })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected refusal")
    expect(result.error).toContain("running")
  })

  test("keep refuses a selection that would blank the result", () => {
    // `kept` REPLACES the result on the wire, so keeping nothing would destroy exactly the content
    // being narrowed, and the model would receive an empty tool result carrying only its call id.
    seedTool("prt_blank", "completed", five)
    const result = call({ id: "prt_blank", pattern: "no such line", keep: true })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected refusal")
    expect(result.error).toContain("EMPTY")
  })

  test("keep narrows an ERRORED result — an error has no size gate, so this is the only way to clean it up", () => {
    seed("prt_err_keep", "tool", {
      type: "tool",
      tool: "bash",
      state: { status: "error", error: "boom: exit 2\nsecond line\nnoise" },
    })
    const narrowed = call({ id: "prt_err_keep", range: "1-2", keep: true })
    if (!narrowed.ok) throw new Error(narrowed.error)
    expect(narrowed.kept).toEqual({ from: 1, to: 2, reason: "test" })

    // The whole failure stays reachable: keep narrows what replays, it does not delete.
    const whole = call({ id: "prt_err_keep", range: "0" })
    if (!whole.ok) throw new Error(whole.error)
    expect(whole.matchedLines).toBe(3)
  })

  test("an errored result is still filterable with range and pattern", () => {
    seed("prt_err_filter", "tool", { type: "tool", tool: "bash", state: { status: "error", error: "boom: exit 2\nsecond line" } })
    const result = call({ id: "prt_err_filter", range: "2" })
    if (!result.ok) throw new Error(result.error)
    expect(result.text).toContain("2: second line")
  })
})
