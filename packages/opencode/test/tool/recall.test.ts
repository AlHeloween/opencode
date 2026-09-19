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
db.exec("CREATE TABLE part (id TEXT PRIMARY KEY, type TEXT NOT NULL, data TEXT NOT NULL)")
const insert = db.prepare("INSERT INTO part (id, type, data) VALUES (?, ?, ?)")

function seedTool(id: string, status: string, output: string, tool = "grep", title?: string) {
  insert.run(id, "tool", JSON.stringify({ type: "tool", tool, state: { status, output, ...(title === undefined ? {} : { title }) } }))
}

function call(input: { id: string; range?: string; pattern?: string; ignoreCase?: boolean; maxChars?: number }) {
  return readToolResult({ dbPath, maxChars: 32_000, ...input })
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
    insert.run("prt_text", "text", JSON.stringify({ type: "text", text: "hello" }))
    const result = call({ id: "prt_text" })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected refusal")
    expect(result.error).toContain("not a tool result")
  })

  test("refuses an unknown id", () => {
    expect(call({ id: "prt_missing" }).ok).toBe(false)
  })

  test("refuses a failed or unfinished result — a dead end is not worth a round trip", () => {
    seedTool("prt_run", "running", "partial", "bash")
    seedTool("prt_err", "error", "boom", "bash")
    for (const id of ["prt_run", "prt_err"]) {
      const result = call({ id })
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error("expected refusal")
      expect(result.error).toContain("not recallable")
    }
  })
})
